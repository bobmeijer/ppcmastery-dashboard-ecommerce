import { TIME_ZONE } from '@/lib/config';
import 'server-only';
import type { Account } from '@/lib/accounts';
import { getCustomer } from '@/lib/googleAds/client';
import { fetchAdsFeedProducts } from '@/lib/googleAds/feedProducts';
import { fetchMerchantProducts } from '@/lib/merchant/client';
import { feedDestinations, feedTotals, mergeFeedProducts } from '@/lib/feedBuild';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { completeRun, failRun, startRun } from './runs';

export interface FeedSyncResult {
  accountId: string;
  dataset: 'feed';
  status: 'complete';
  snapshotDate: string;
  rows: number;
  adsProducts: number;
  merchantProducts: number;
  blocked: number;
  durationMs: number;
  runId: string;
}

// Calendar day in the dashboard's time zone, so a 06:00 run lands on today.
const accountDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date);

// Google Ads shopping_product + Merchant API products for one account, merged
// and published in one transaction (full replace of feed_products, upsert of
// the day's feed_daily row). An account without a Merchant id syncs the Google
// Ads side only.
export async function syncFeed(account: Account): Promise<FeedSyncResult> {
  const startedAt = Date.now();
  const snapshotDate = accountDate();
  const runId = await startRun({
    source: 'merchant', dataset: 'feed', accountId: account.id, startDate: snapshotDate, endDate: snapshotDate,
    metadata: { merchantId: account.merchant_id },
  });
  try {
    const customer = getCustomer(account.id, account.login_customer_id);
    const [ads, merchant] = await Promise.all([
      fetchAdsFeedProducts(customer, account.label),
      account.merchant_id ? fetchMerchantProducts(account.merchant_id) : Promise.resolve([]),
    ]);
    const rows = mergeFeedProducts(ads, merchant);
    const totals = feedTotals(rows);
    const byDestination = feedDestinations(merchant);
    const { data, error } = await getSupabaseAdmin().rpc('publish_feed_snapshot', {
      p_account_id: account.id, p_snapshot_date: snapshotDate, p_products: rows, p_totals: totals, p_by_destination: byDestination,
    });
    assertOk(error, 'Unable to publish feed snapshot');
    const published = Number(data ?? rows.length);
    const durationMs = Date.now() - startedAt;
    await completeRun(runId, published, durationMs, { adsProducts: ads.length, merchantProducts: merchant.length, totals });
    return {
      accountId: account.id, dataset: 'feed', status: 'complete', snapshotDate, rows: published,
      adsProducts: ads.length, merchantProducts: merchant.length, blocked: totals.blocked, durationMs, runId,
    };
  } catch (error) {
    await failRun(runId, error, Date.now() - startedAt);
    throw error;
  }
}
