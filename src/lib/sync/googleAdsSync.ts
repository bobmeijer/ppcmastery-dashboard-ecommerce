import 'server-only';
import type { Account } from '@/lib/accounts';
import { getCustomer } from '@/lib/googleAds/client';
import {
  Dataset, FACT_TABLE, fetchCampaignDaily, fetchCampaignDim, fetchChangeEvents, fetchConversionsDaily, fetchDeviceDaily,
  fetchGeoDaily, fetchProductDaily, fetchProductMonthly,
} from '@/lib/googleAds/datasets';
import type { ChangeEventRow } from '@/lib/googleAds/changeEvents';
import { fetchKeywordDim, fetchKeywordQualityDaily, KeywordQualityRow } from '@/lib/googleAds/keywordQuality';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { completeRun, failRun, startRun } from './runs';

export type Grain = 'day' | 'month';
export type Platform = 'google' | 'microsoft';

export interface SyncResult {
  accountId: string;
  dataset: Dataset;
  grain: Grain;
  startDate: string;
  endDate: string;
  rows: number;
  durationMs: number;
  runId: string;
}

const PUBLISH_CHUNK_ROWS = 20_000;
const CHANGE_EVENT_CHUNK_ROWS = 2_000;
// Daily product rows are kept from this date on (from 2026-01-01,
// replacing the rolling 90 days), so any period since then has per-day labels.
const PRODUCT_DAILY_FLOOR = '2026-01-01';

const toDate = (value: string) => new Date(`${value}T00:00:00Z`);
const fmt = (date: Date) => date.toISOString().slice(0, 10);
export const monthStart = (value: string) => `${value.slice(0, 7)}-01`;

// Publishes rows for one account and range in one or more transactions. The
// first chunk replaces the covered interval; later chunks only insert, and the
// run is completed on the last one so readers never see a half-written range.
export async function publishFacts(table: string, accountId: string, start: string, end: string, runId: string, rows: Record<string, unknown>[], platform: Platform = 'google') {
  const supabase = getSupabaseAdmin();
  if (rows.length === 0) {
    const { error } = await supabase.rpc('publish_daily_facts', {
      p_table: table, p_account_id: accountId, p_start_date: start, p_end_date: end,
      p_sync_run_id: runId, p_rows: [], p_complete_run: true, p_platform: platform,
    });
    assertOk(error, `Unable to publish empty ${table} range`);
    return 0;
  }
  // Order rows by date so a chunk boundary can be expressed as a date interval:
  // chunk 1 replaces [start, end] wholesale, later chunks must not delete again.
  rows.sort((a, b) => String(a.fact_date).localeCompare(String(b.fact_date)));
  let published = 0;
  for (let index = 0; index < rows.length; index += PUBLISH_CHUNK_ROWS) {
    const chunk = rows.slice(index, index + PUBLISH_CHUNK_ROWS);
    const isFirst = index === 0;
    const isLast = index + PUBLISH_CHUNK_ROWS >= rows.length;
    if (isFirst) {
      const { data, error } = await supabase.rpc('publish_daily_facts', {
        p_table: table, p_account_id: accountId, p_start_date: start, p_end_date: end,
        p_sync_run_id: runId, p_rows: chunk, p_complete_run: isLast, p_platform: platform,
      });
      assertOk(error, `Unable to publish ${table}`);
      published += Number(data ?? chunk.length);
    } else {
      // Subsequent chunks: plain insert (range already cleared by chunk 1).
      const { error } = await supabase.from(table).insert(chunk.map(row => ({ ...row, account_id: accountId, platform, sync_run_id: runId })));
      assertOk(error, `Unable to insert ${table} chunk`);
      published += chunk.length;
    }
  }
  return published;
}

// Change events accumulate: every chunk is an upsert keyed on
// (account, resource, time), nothing in the window is deleted first. Rows
// carry old_resource / new_resource payloads, so chunks stay small.
async function publishChangeEvents(accountId: string, runId: string, rows: ChangeEventRow[]): Promise<number> {
  const supabase = getSupabaseAdmin();
  let published = 0;
  for (let index = 0; index < rows.length; index += CHANGE_EVENT_CHUNK_ROWS) {
    const chunk = rows.slice(index, index + CHANGE_EVENT_CHUNK_ROWS).map(row => ({ ...row, sync_run_id: runId }));
    const { data, error } = await supabase.rpc('publish_change_events', { p_account_id: accountId, p_rows: chunk });
    assertOk(error, 'Unable to publish change events');
    published += Number(data ?? chunk.length);
  }
  return published;
}

// Keyword quality rows: the first chunk replaces the range (publish_keyword_quality),
// later chunks of the same run insert directly, as in publishFacts.
export async function publishKeywordQuality(accountId: string, start: string, end: string, runId: string, rows: KeywordQualityRow[], platform: Platform = 'google') {
  const supabase = getSupabaseAdmin();
  rows.sort((a, b) => a.fact_date.localeCompare(b.fact_date));
  let published = 0;
  for (let index = 0; index === 0 || index < rows.length; index += PUBLISH_CHUNK_ROWS) {
    const chunk = rows.slice(index, index + PUBLISH_CHUNK_ROWS);
    if (index === 0) {
      const { data, error } = await supabase.rpc('publish_keyword_quality', { p_account_id: accountId, p_start_date: start, p_end_date: end, p_sync_run_id: runId, p_rows: chunk, p_platform: platform });
      assertOk(error, 'Unable to publish keyword quality');
      published += Number(data ?? chunk.length);
    } else {
      const { error } = await supabase.from('ads_keyword_quality_daily').insert(chunk.map(row => ({ ...row, account_id: accountId, platform, sync_run_id: runId })));
      assertOk(error, 'Unable to insert keyword quality chunk');
      published += chunk.length;
    }
  }
  return published;
}

export async function syncCampaignDim(account: Account): Promise<number> {
  const customer = getCustomer(account.id, account.login_customer_id);
  const rows = await fetchCampaignDim(customer, account.label);
  const { data, error } = await getSupabaseAdmin().rpc('upsert_campaign_dim', { p_account_id: account.id, p_rows: rows });
  assertOk(error, 'Unable to upsert campaign dimension');
  return Number(data ?? rows.length);
}

export async function syncDataset(account: Account, dataset: Dataset, start: string, end: string, grain: Grain = 'day'): Promise<SyncResult> {
  const startedAt = Date.now();
  const runId = await startRun({
    source: 'google_ads', dataset: grain === 'month' ? `${dataset}_monthly` : dataset, accountId: account.id,
    startDate: start, endDate: end, metadata: { grain },
  });
  try {
    const customer = getCustomer(account.id, account.login_customer_id);
    let rows = 0;

    if (dataset === 'product' && grain === 'month') {
      const data = await fetchProductMonthly(customer, account.label, start, end);
      const { data: count, error } = await getSupabaseAdmin().rpc('publish_product_monthly', {
        p_account_id: account.id, p_start_month: monthStart(start), p_end_month: monthStart(end),
        p_sync_run_id: runId, p_rows: data, p_complete_run: true,
      });
      assertOk(error, 'Unable to publish product monthly rows');
      rows = Number(count ?? data.length);
    } else if (dataset === 'quality') {
      const [daily, dim] = await Promise.all([
        fetchKeywordQualityDaily(customer, account.label, start, end),
        fetchKeywordDim(customer, account.label),
      ]);
      const { error } = await getSupabaseAdmin().rpc('publish_keyword_dim', { p_account_id: account.id, p_rows: dim });
      assertOk(error, 'Unable to publish keyword dimension');
      rows = await publishKeywordQuality(account.id, start, end, runId, daily);
    } else if (dataset === 'changes') {
      const data = await fetchChangeEvents(customer, account.label, start, end);
      rows = await publishChangeEvents(account.id, runId, data);
    } else {
      let data: Record<string, unknown>[];
      if (dataset === 'campaign') {
        await syncCampaignDim(account);
        data = await fetchCampaignDaily(customer, account.label, start, end);
      } else if (dataset === 'conversions') {
        data = await fetchConversionsDaily(customer, account.label, start, end);
      } else if (dataset === 'geo') {
        data = await fetchGeoDaily(customer, account.label, start, end);
      } else if (dataset === 'device') {
        data = await fetchDeviceDaily(customer, account.label, start, end);
      } else {
        data = await fetchProductDaily(customer, account.label, start, end);
      }
      rows = await publishFacts(FACT_TABLE[dataset], account.id, start, end, runId, data);
      if (dataset === 'product') await pruneProductDaily(account.id);
    }

    const durationMs = Date.now() - startedAt;
    await completeRun(runId, rows, durationMs, { grain });
    return { accountId: account.id, dataset, grain, startDate: start, endDate: end, rows, durationMs, runId };
  } catch (error) {
    await failRun(runId, error, Date.now() - startedAt);
    throw error;
  }
}

// Daily product rows before the floor are dropped once the monthly rollup
// covers them. The monthly rollup for the current and previous month is
// refreshed by the daily product cron.
export async function pruneProductDaily(accountId: string, platform: Platform = 'google') {
  const cutoffDate = PRODUCT_DAILY_FLOOR;
  const supabase = getSupabaseAdmin();
  const { data: covered } = await supabase.from('ads_product_monthly').select('fact_month')
    .eq('account_id', accountId).eq('platform', platform).lte('fact_month', monthStart(cutoffDate)).order('fact_month', { ascending: false }).limit(1);
  if (!covered || covered.length === 0) return;
  const { error } = await supabase.from('ads_product_daily').delete().eq('account_id', accountId).eq('platform', platform).lt('fact_date', cutoffDate);
  assertOk(error, 'Unable to prune product daily rows');
}

export const defaultWindow = (dataset: Dataset, days?: number) => {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // yesterday: today is always partial
  const start = new Date(end);
  // changes: Google only reaches back 30 days and the table accumulates, so the
  // daily cron just re-reads yesterday and the day before (upsert).
  // quality: historical Quality Score settles within days; two weeks of re-sync is plenty.
  const span = days ?? (dataset === 'product' ? 35 : dataset === 'changes' ? 2 : dataset === 'quality' ? 14 : 56);
  start.setUTCDate(start.getUTCDate() - (span - 1));
  return { start: fmt(start), end: fmt(end) };
};

export const previousMonths = (count: number) => {
  const months: { start: string; end: string }[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  for (let i = 0; i < count; i += 1) {
    const start = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const end = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    // Up to yesterday: today is partial and would put a half day into the monthly rollup.
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    if (start > yesterday) { cursor.setUTCMonth(cursor.getUTCMonth() - 1); continue; }
    months.push({ start: fmt(start), end: fmt(end > yesterday ? yesterday : end) });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return months;
};

export { toDate };
