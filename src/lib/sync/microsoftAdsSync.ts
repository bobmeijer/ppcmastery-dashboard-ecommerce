import 'server-only';
import type { Account } from '@/lib/accounts';
import { MsAccount, runReport } from '@/lib/microsoftAds/client';
import {
  mapCampaignDaily, mapCampaignDim, mapConversionsDaily, mapDeviceDaily, mapGeoDaily, mapKeywordDim, mapKeywordQualityDaily, mapProducts,
} from '@/lib/microsoftAds/mapping';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { Grain, monthStart, publishFacts, publishKeywordQuality, pruneProductDaily, SyncResult } from './googleAdsSync';
import { completeRun, failRun, startRun } from './runs';

// Microsoft Advertising into the shared fact tables with platform = 'microsoft'
//. Same datasets, windows and publish path as Google; change
// history, feed and auction insights stay Google-only for now.

export type MsDataset = 'campaign' | 'conversions' | 'geo' | 'device' | 'product' | 'quality';
export const MS_DATASETS: MsDataset[] = ['campaign', 'conversions', 'geo', 'device', 'product', 'quality'];

const TABLE: Record<Exclude<MsDataset, 'quality'>, string> = {
  campaign: 'ads_campaign_daily',
  conversions: 'ads_conversions_daily',
  geo: 'ads_geo_daily',
  device: 'ads_device_daily',
  product: 'ads_product_daily',
};

// Microsoft keeps campaign history: the dimension comes from a Summary report
// since this date, so removed campaigns keep their names.
const DIM_HISTORY_START = '2024-01-01';

const TRAFFIC = ['Impressions', 'Clicks', 'Spend', 'ConversionsQualified', 'Revenue'];
const PRODUCT_COLUMNS = ['TimePeriod', 'CampaignId', 'MerchantProductId', 'Title', 'ProductType1', 'ProductType2', 'ProductType3', 'Brand',
  'CustomLabel0', 'CustomLabel1', 'CustomLabel2', 'CustomLabel3', 'CustomLabel4', 'CountryOfSale', ...TRAFFIC];

export const msAccountOf = (account: Account): MsAccount | null =>
  account.msads_account_id && account.msads_customer_id ? { accountId: account.msads_account_id, customerId: account.msads_customer_id } : null;

const yesterday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function syncMsCampaignDim(account: Account, ms: MsAccount): Promise<number> {
  const rows = await runReport(ms, 'CampaignPerformanceReport',
    ['CampaignId', 'CampaignName', 'CampaignType', 'CampaignStatus', 'Impressions'], DIM_HISTORY_START, yesterday(), 'Summary', 'campaign dim');
  const dim = rows.filter(r => r.CampaignId).map(mapCampaignDim);
  const { data, error } = await getSupabaseAdmin().rpc('upsert_campaign_dim', { p_account_id: account.id, p_rows: dim, p_platform: 'microsoft' });
  assertOk(error, 'Unable to upsert Microsoft campaign dimension');
  return Number(data ?? dim.length);
}

export async function syncMsDataset(account: Account, dataset: MsDataset, start: string, end: string, grain: Grain = 'day'): Promise<SyncResult> {
  const ms = msAccountOf(account);
  if (!ms) throw new Error(`${account.label} has no Microsoft Ads account`);
  const startedAt = Date.now();
  const runId = await startRun({
    source: 'microsoft_ads', dataset: grain === 'month' ? `${dataset}_monthly` : dataset, accountId: account.id,
    startDate: start, endDate: end, metadata: { grain, msAccountId: ms.accountId },
  });
  try {
    let rows = 0;
    if (dataset === 'product' && grain === 'month') {
      const data = mapProducts(await runReport(ms, 'ProductDimensionPerformanceReport', PRODUCT_COLUMNS, start, end, 'Monthly', 'product monthly'), 'fact_month');
      const { data: count, error } = await getSupabaseAdmin().rpc('publish_product_monthly', {
        p_account_id: account.id, p_start_month: monthStart(start), p_end_month: monthStart(end),
        p_sync_run_id: runId, p_rows: data, p_complete_run: true, p_platform: 'microsoft',
      });
      assertOk(error, 'Unable to publish Microsoft product monthly rows');
      rows = Number(count ?? data.length);
    } else if (dataset === 'quality') {
      const [daily, dim] = await Promise.all([
        runReport(ms, 'KeywordPerformanceReport', ['TimePeriod', 'CampaignId', 'AdGroupId', 'KeywordId', ...TRAFFIC,
          'HistoricalQualityScore', 'HistoricalExpectedCtr', 'HistoricalAdRelevance', 'HistoricalLandingPageExperience'], start, end, 'Daily', 'keyword quality'),
        runReport(ms, 'KeywordPerformanceReport', ['CampaignId', 'AdGroupId', 'AdGroupName', 'KeywordId', 'Keyword', 'BidMatchType', 'KeywordStatus',
          'QualityScore', 'ExpectedCtr', 'AdRelevance', 'LandingPageExperience', 'Impressions'], DIM_HISTORY_START, yesterday(), 'Summary', 'keyword dim'),
      ]);
      const { error } = await getSupabaseAdmin().rpc('publish_keyword_dim', { p_account_id: account.id, p_rows: mapKeywordDim(dim), p_platform: 'microsoft' });
      assertOk(error, 'Unable to publish Microsoft keyword dimension');
      rows = await publishKeywordQuality(account.id, start, end, runId, mapKeywordQualityDaily(daily), 'microsoft');
    } else {
      let data: Record<string, unknown>[];
      if (dataset === 'campaign') {
        await syncMsCampaignDim(account, ms);
        data = mapCampaignDaily(await runReport(ms, 'CampaignPerformanceReport', ['TimePeriod', 'CampaignId', ...TRAFFIC,
          'AllConversionsQualified', 'AllRevenue', 'ImpressionSharePercent', 'ImpressionLostToBudgetPercent', 'ImpressionLostToRankAggPercent',
          'TopImpressionRatePercent', 'AbsoluteTopImpressionRatePercent'], start, end, 'Daily', 'campaign'));
      } else if (dataset === 'conversions') {
        // GoalsAndFunnelsReport, not ConversionPerformanceReport: the latter only counts
        // conversions tied to a keyword and drops Shopping.
        data = mapConversionsDaily(await runReport(ms, 'GoalsAndFunnelsReport', ['TimePeriod', 'CampaignId', 'Goal', 'GoalId',
          'AllConversionsQualified', 'AllRevenue', 'ViewThroughConversionsQualified'], start, end, 'Daily', 'conversions'));
      } else if (dataset === 'geo') {
        data = mapGeoDaily(await runReport(ms, 'GeographicPerformanceReport', ['TimePeriod', 'CampaignId', 'Country', 'LocationType', ...TRAFFIC],
          start, end, 'Daily', 'geo'));
      } else if (dataset === 'device') {
        data = mapDeviceDaily(await runReport(ms, 'CampaignPerformanceReport', ['TimePeriod', 'CampaignId', 'DeviceType', ...TRAFFIC],
          start, end, 'Daily', 'device'));
      } else {
        data = mapProducts(await runReport(ms, 'ProductDimensionPerformanceReport', PRODUCT_COLUMNS, start, end, 'Daily', 'product'), 'fact_date');
      }
      rows = await publishFacts(TABLE[dataset], account.id, start, end, runId, data, 'microsoft');
      if (dataset === 'product') await pruneProductDaily(account.id, 'microsoft');
    }

    const durationMs = Date.now() - startedAt;
    await completeRun(runId, rows, durationMs, { grain });
    return { accountId: account.id, dataset: dataset as SyncResult['dataset'], grain, startDate: start, endDate: end, rows, durationMs, runId };
  } catch (error) {
    await failRun(runId, error, Date.now() - startedAt);
    throw error;
  }
}
