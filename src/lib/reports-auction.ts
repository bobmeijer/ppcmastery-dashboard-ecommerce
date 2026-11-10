import { serverAccountSettings } from '../../dashboard.server';
import 'server-only';
// Reader for the Auction insights page: aggregated auction insights from
// auction_insights_daily (migration 0012), filled by the daily Drive sync and
// the CSV backfill (src/lib/sync/auctionSync.ts).
import type { AuctionGrain, AuctionNetwork, AuctionRow } from '@/lib/auctionShaping';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export interface AuctionCoverage { network: AuctionNetwork; first_date: string; last_date: string }
export interface AuctionCategory { network: AuctionNetwork; category: string; eligible: number }

// Competitors to always show on the Auction insights page, per label, as domains.
export const auctionWatchlist = (label: string) => serverAccountSettings(label).auctionWatchlist ?? [];

export async function readAuctionInsights(accountIds: string[], start: string, end: string, grain: AuctionGrain | 'all', network: AuctionNetwork | null, category: string | null): Promise<AuctionRow[]> {
  const { data, error } = await getSupabaseAdmin().rpc('read_auction_insights_json', {
    p_account_ids: accountIds, p_start_date: start, p_end_date: end, p_grain: grain, p_network: network, p_category: category,
  });
  assertOk(error, 'Unable to read auction insights');
  return (data || []) as AuctionRow[];
}

export async function readAuctionCategories(accountIds: string[], start: string, end: string): Promise<AuctionCategory[]> {
  const { data, error } = await getSupabaseAdmin().rpc('read_auction_categories_json', { p_account_ids: accountIds, p_start_date: start, p_end_date: end });
  assertOk(error, 'Unable to read auction categories');
  return (data || []) as AuctionCategory[];
}

export async function readAuctionCoverage(accountIds: string[]): Promise<AuctionCoverage[]> {
  const { data, error } = await getSupabaseAdmin().rpc('read_auction_coverage_json', { p_account_ids: accountIds });
  assertOk(error, 'Unable to read auction coverage');
  return (data || []) as AuctionCoverage[];
}
