// Microsoft Advertising report rows to the shared fact-table rows. Pure, tested
// in mapping.test.ts. Conventions follow the Google mappers so both platforms
// land in the same columns:
// - conversions = ConversionsQualified (fractional, attribution-weighted), value = Revenue
// - item ids, product types, brand and custom labels lowercased (Google returns them so)
// - countries as Google criterion ids + ISO codes, devices as Google's enum names
// - Quality Score components on Google's bucket scale (2 below, 3 average, 4 above)
import { classifyCampaign } from '@/lib/campaignParser';
import { msNum, msShare } from './csv';

type Row = Record<string, string>;

const COUNTRY_BY_NAME: Record<string, { code: string; criterion: string }> = {
  netherlands: { code: 'NL', criterion: '2528' },
  belgium: { code: 'BE', criterion: '2056' },
  germany: { code: 'DE', criterion: '2276' },
  luxembourg: { code: 'LU', criterion: '2442' },
  france: { code: 'FR', criterion: '2250' },
  'united kingdom': { code: 'GB', criterion: '2826' },
  austria: { code: 'AT', criterion: '2040' },
  switzerland: { code: 'CH', criterion: '2756' },
};
export const country = (name: string) => {
  const known = COUNTRY_BY_NAME[name.trim().toLowerCase()];
  return known ? known : { code: 'Other', criterion: `ms:${name.trim() || 'unknown'}` };
};

const DEVICES: Record<string, string> = { computer: 'DESKTOP', smartphone: 'MOBILE', tablet: 'TABLET' };
export const device = (name: string) => DEVICES[name.trim().toLowerCase()] || 'OTHER';

const CHANNELS: Record<string, string> = {
  'search & content': 'SEARCH', search: 'SEARCH', shopping: 'SHOPPING', 'performance max': 'PERFORMANCE_MAX',
  audience: 'DISPLAY', 'dynamic search ads': 'SEARCH', hotel: 'OTHER', app: 'OTHER',
};
export const channel = (type: string) => CHANNELS[type.trim().toLowerCase()] || type.trim().toUpperCase();

// Active = serving; Deleted = removed; everything else (Paused, BudgetPaused,
// Suspended, ...) reads as paused in the status filter.
export const status = (value: string) => {
  const v = value.trim().toLowerCase();
  if (v === 'active') return 'ENABLED';
  if (v === 'deleted') return 'REMOVED';
  return 'PAUSED';
};

const lower = (value: string | undefined) => String(value ?? '').trim().toLowerCase();

const traffic = (r: Row) => ({
  impressions: msNum(r.Impressions),
  clicks: msNum(r.Clicks),
  cost: msNum(r.Spend),
  conversions: msNum(r.ConversionsQualified),
  conversions_value: msNum(r.Revenue),
});
const hasTraffic = (t: { impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }) =>
  t.impressions > 0 || t.clicks > 0 || t.cost > 0 || t.conversions > 0 || t.conversions_value > 0;

// --- campaign dimension (Summary report: one row per campaign) -----------------

export function mapCampaignDim(r: Row) {
  const channelType = channel(r.CampaignType || '');
  return {
    campaign_id: r.CampaignId,
    campaign_name: r.CampaignName,
    channel_type: channelType,
    status: status(r.CampaignStatus || ''),
    bidding_strategy_type: '',
    target_roas: null,
    target_cpa: null,
    budget_amount: null,
    ...classifyCampaign(r.CampaignName, channelType),
  };
}

// --- daily facts ----------------------------------------------------------------

export function mapCampaignDaily(rows: Row[]) {
  return rows.map(r => ({
    fact_date: r.TimePeriod,
    campaign_id: r.CampaignId,
    ...traffic(r),
    all_conversions: msNum(r.AllConversionsQualified),
    all_conversions_value: msNum(r.AllRevenue),
    search_impression_share: msShare(r.ImpressionSharePercent),
    search_budget_lost_is: msShare(r.ImpressionLostToBudgetPercent),
    search_rank_lost_is: msShare(r.ImpressionLostToRankAggPercent),
    top_impression_pct: msShare(r.TopImpressionRatePercent),
    abs_top_impression_pct: msShare(r.AbsoluteTopImpressionRatePercent),
  })).filter(r => hasTraffic(r) || r.all_conversions > 0 || r.all_conversions_value > 0);
}

// From GoalsAndFunnelsReport, which reconciles with the campaign totals. It has no
// ConversionsQualified / Revenue columns: conversions = all minus view-through,
// value = AllRevenue (view-through revenue is not in it). GoalId 0 is the "no goal"
// row Microsoft adds per campaign-day; it carries no conversions.
export function mapConversionsDaily(rows: Row[]) {
  return rows.map(r => ({
    fact_date: r.TimePeriod,
    campaign_id: r.CampaignId,
    conversion_action_id: r.GoalId,
    conversion_action_name: r.Goal || '',
    conversions: Math.max(0, msNum(r.AllConversionsQualified) - msNum(r.ViewThroughConversionsQualified)),
    conversions_value: msNum(r.AllRevenue),
    all_conversions: msNum(r.AllConversionsQualified),
    all_conversions_value: msNum(r.AllRevenue),
  })).filter(r => r.conversion_action_id && r.conversion_action_id !== '0'
    && (r.conversions > 0 || r.conversions_value > 0 || r.all_conversions > 0 || r.all_conversions_value > 0));
}

const sumInto = <T extends Record<string, unknown>>(map: Map<string, T>, key: string, base: T, add: ReturnType<typeof traffic>) => {
  const current = map.get(key) || base;
  for (const k of ['impressions', 'clicks', 'cost', 'conversions', 'conversions_value'] as const) {
    (current as any)[k] = Number((current as any)[k] || 0) + add[k];
  }
  map.set(key, current);
};

// User location only ("Physical location"), like Google's LOCATION_OF_PRESENCE;
// Microsoft may split a country over several rows, they are summed.
export function mapGeoDaily(rows: Row[]) {
  const merged = new Map<string, any>();
  for (const r of rows) {
    if (lower(r.LocationType) !== 'physical location') continue;
    const t = traffic(r);
    if (!hasTraffic(t)) continue;
    const c = country(r.Country || '');
    sumInto(merged, `${r.TimePeriod}|${r.CampaignId}|${c.criterion}`, {
      fact_date: r.TimePeriod, campaign_id: r.CampaignId, country_criterion_id: c.criterion, country_code: c.code,
    }, t);
  }
  return [...merged.values()];
}

export function mapDeviceDaily(rows: Row[]) {
  const merged = new Map<string, any>();
  for (const r of rows) {
    const t = traffic(r);
    if (!hasTraffic(t)) continue;
    const d = device(r.DeviceType || '');
    sumInto(merged, `${r.TimePeriod}|${r.CampaignId}|${d}`, { fact_date: r.TimePeriod, campaign_id: r.CampaignId, device: d }, t);
  }
  return [...merged.values()];
}

// One row per period x campaign x product x country; attribute changes inside
// the period are merged with the last row's attributes winning, as for Google.
export function mapProducts(rows: Row[], periodKey: 'fact_date' | 'fact_month') {
  const merged = new Map<string, any>();
  for (const r of rows) {
    const t = traffic(r);
    if (!hasTraffic(t)) continue;
    const period = periodKey === 'fact_month' ? `${r.TimePeriod.slice(0, 7)}-01` : r.TimePeriod;
    const item = lower(r.MerchantProductId);
    const c = country(r.CountryOfSale || '');
    const key = `${period}|${r.CampaignId}|${item}|${c.code}`;
    const attributes = {
      [periodKey]: period,
      campaign_id: r.CampaignId,
      product_item_id: item,
      product_title: r.Title || '',
      product_type: [r.ProductType1, r.ProductType2, r.ProductType3].map(lower).filter(Boolean).join(' > '),
      brand: lower(r.Brand),
      custom_label_0: lower(r.CustomLabel0),
      custom_label_1: lower(r.CustomLabel1),
      custom_label_2: lower(r.CustomLabel2),
      custom_label_3: lower(r.CustomLabel3),
      custom_label_4: lower(r.CustomLabel4),
      country_code: c.code,
    };
    const current = merged.get(key);
    merged.set(key, { ...(current || {}), ...attributes });
    sumInto(merged, key, merged.get(key), t);
  }
  return [...merged.values()];
}

// --- Quality Score ----------------------------------------------------------------

// Microsoft components: 1 below average, 2 average, 3 above average; Google: 2 / 3 / 4.
export const component = (value: string | undefined): number | null => {
  const n = Number(String(value ?? '').trim());
  return n >= 1 && n <= 3 ? n + 1 : null;
};
export const qualityScore = (value: string | undefined): number | null => {
  const n = Number(String(value ?? '').trim());
  return n >= 1 && n <= 10 ? n : null;
};

export function mapKeywordQualityDaily(rows: Row[]) {
  return rows.map(r => ({
    fact_date: r.TimePeriod,
    campaign_id: r.CampaignId,
    ad_group_id: r.AdGroupId,
    criterion_id: r.KeywordId,
    ...traffic(r),
    quality_score: qualityScore(r.HistoricalQualityScore),
    expected_ctr: component(r.HistoricalExpectedCtr),
    ad_relevance: component(r.HistoricalAdRelevance),
    landing_page: component(r.HistoricalLandingPageExperience),
  })).filter(r => r.impressions > 0);
}

export function mapKeywordDim(rows: Row[]) {
  const seen = new Map<string, any>();
  for (const r of rows) {
    seen.set(`${r.AdGroupId}|${r.KeywordId}`, {
      ad_group_id: r.AdGroupId,
      criterion_id: r.KeywordId,
      campaign_id: r.CampaignId,
      ad_group_name: r.AdGroupName || '',
      keyword_text: r.Keyword || '',
      match_type: r.BidMatchType ? r.BidMatchType.trim().toUpperCase() : null,
      status: r.KeywordStatus ? status(r.KeywordStatus) : null,
      quality_score: qualityScore(r.QualityScore),
      expected_ctr: component(r.ExpectedCtr),
      ad_relevance: component(r.AdRelevance),
      landing_page: component(r.LandingPageExperience),
    });
  }
  return [...seen.values()];
}
