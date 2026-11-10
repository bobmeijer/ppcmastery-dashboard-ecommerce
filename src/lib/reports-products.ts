import 'server-only';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';
import { buildProductsReport, FeedProductInfo, ProductFactRow, ProductsReportBody } from './productsShaping';
import { readFeedProducts } from './reports-feed';
import type { TypeFilter } from './productTypes';

// read_product_facts_json picks the daily table when the window sits inside
// the retained daily rows, otherwise the monthly table. Rows are product x
// campaign x label x country; we collapse them here, join the latest feed
// state (title, link, image, current label) and apply the product type filter,
// so the browser only receives the product list the page renders.
export async function readProductFacts(accountIds: string[], start: string, end: string, platforms: string[] | null = null): Promise<ProductFactRow[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().rpc('read_product_facts_json', {
    p_account_ids: accountIds, p_start_date: start, p_end_date: end, p_platforms: platforms,
  });
  assertOk(error, 'Unable to read product facts');
  return (data || []) as ProductFactRow[];
}

// Product types (level 1, lowercased) the account leaves out by default.
export async function readTypeExclusions(accountIds: string[]): Promise<string[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin().from('product_type_exclusions').select('type_level1').in('account_id', accountIds);
  assertOk(error, 'Unable to read product type exclusions');
  return [...new Set((data || []).map(r => String(r.type_level1).toLowerCase()))];
}

export async function readProductsReport(accountIds: string[], start: string, end: string, filter: TypeFilter, platforms: string[] | null = null): Promise<ProductsReportBody> {
  const [rows, feed, excluded] = await Promise.all([
    readProductFacts(accountIds, start, end, platforms),
    accountIds.length ? readFeedProducts(accountIds) : Promise.resolve([]),
    readTypeExclusions(accountIds),
  ]);
  return buildProductsReport(rows, feed as FeedProductInfo[], filter, excluded, !platforms?.includes('microsoft'));
}

// Latest product fact date per account (daily table), for the top bar.
export async function readProductFreshness(accountIds: string[], platforms: string[] | null = null) {
  const supabase = getSupabaseAdmin();
  const result: Record<string, string | null> = {};
  for (const id of accountIds) {
    let query = supabase.from('ads_product_daily').select('fact_date').eq('account_id', id);
    if (platforms) query = query.in('platform', platforms);
    const { data } = await query.order('fact_date', { ascending: false }).limit(1).maybeSingle();
    result[id] = data?.fact_date || null;
  }
  return result;
}
