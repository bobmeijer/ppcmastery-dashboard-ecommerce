import { isAccountLabel } from '@/lib/config';
import 'server-only';
import type { Account } from './accounts';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';
import { buildFeedSnapshot, FeedDailyRow, FeedProductRow } from './feedBuild';
import type { FeedSnapshot } from './feedShaping';

const HISTORY_DAYS = 90;

export interface StoredFeedProduct extends FeedProductRow { account_id: string; synced_at: string }

export async function readFeedProducts(accountIds: string[]): Promise<StoredFeedProduct[]> {
  const { data, error } = await getSupabaseAdmin().rpc('read_feed_products_json', { p_account_ids: accountIds });
  assertOk(error, 'Unable to read feed products');
  return (data || []) as StoredFeedProduct[];
}

async function readFeedDaily(accountId: string): Promise<FeedDailyRow[]> {
  const start = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await getSupabaseAdmin().rpc('read_feed_daily_json', { p_account_id: accountId, p_start_date: start });
  assertOk(error, 'Unable to read feed history');
  return (data || []) as FeedDailyRow[];
}

// Live snapshot from the feed sync; null until the first sync has run for the account.
export async function readFeedSnapshot(account: Account): Promise<FeedSnapshot | null> {
  if (!isAccountLabel(account.label)) return null;
  const [rows, daily] = await Promise.all([readFeedProducts([account.id]), readFeedDaily(account.id)]);
  if (rows.length === 0) return null;
  const fetchedAt = rows.map(r => r.synced_at).sort().pop() || new Date().toISOString();
  const snapshot = buildFeedSnapshot({
    label: account.label, merchantId: account.merchant_id || '', rows, daily, fetchedAt,
  });
  return snapshot;
}
