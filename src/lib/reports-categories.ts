import 'server-only';
import { assertOk, getSupabaseAdmin } from './supabaseAdmin';
import type { DateRange } from './metrics';
import { aggregateProductRows, compareBuckets, ProductBucket, productBuckets, ProductCoverage, ProductTypeFact } from './categoriesShaping';

// Oldest day in the daily product table for the account; older data is monthly.
export async function readProductDailyFloor(accountId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().from('ads_product_daily').select('fact_date')
    .eq('account_id', accountId).eq('platform', 'google').order('fact_date').limit(1).maybeSingle();
  assertOk(error, 'Unable to read product retention');
  return data?.fact_date || null;
}

async function readProductBucket(accountId: string, bucket: ProductBucket, platforms: string[] | null): Promise<ProductTypeFact[]> {
  const { data, error } = await getSupabaseAdmin().rpc('read_product_facts_json', {
    p_account_ids: [accountId], p_start_date: bucket.start, p_end_date: bucket.end, p_platforms: platforms,
  });
  assertOk(error, `Unable to read product facts for ${bucket.period}`);
  return aggregateProductRows(bucket.period, (data || []) as Parameters<typeof aggregateProductRows>[1]);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface ProductTypeReport {
  grain: 'day' | 'month';
  coverage: ProductCoverage;
  dailyFloor: string | null;
  effectiveRange: DateRange;          // what the product numbers actually cover
  rows: ProductTypeFact[];            // one row per bucket x l1 x l2
  compareRows: ProductTypeFact[] | null;
}

// One RPC call per bucket (day inside the daily window, else calendar month),
// collapsed to product-type level 1 and 2 before it leaves the server.
// TODO integrator: a grouped RPC (period x product_type) would make this one call.
export async function readProductTypeReport(accountId: string, range: DateRange, compareRange: DateRange | null, platforms: string[] | null = null): Promise<ProductTypeReport> {
  const dailyFloor = await readProductDailyFloor(accountId);
  const plan = productBuckets(range, dailyFloor);
  const comparePlan = compareBuckets(compareRange, dailyFloor, plan.coverage);
  const [current, compare] = await Promise.all([
    mapLimit(plan.buckets, 6, b => readProductBucket(accountId, b, platforms)),
    comparePlan ? mapLimit(comparePlan, 6, b => readProductBucket(accountId, b, platforms)) : Promise.resolve(null),
  ]);
  return {
    grain: plan.grain,
    coverage: plan.coverage,
    dailyFloor,
    effectiveRange: { start: plan.buckets[0]?.start ?? range.start, end: range.end },
    rows: current.flat(),
    compareRows: compare ? compare.flat() : null,
  };
}
