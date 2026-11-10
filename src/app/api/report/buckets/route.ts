import { DEFAULT_SCOPE } from '@/lib/config';
import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { platformsFromUrl } from '@/lib/platform';
import { requireSession } from '@/lib/auth';
import { readFreshness } from '@/lib/reports';
import { readFeedProducts } from '@/lib/reports-feed';
import { readTypeExclusions } from '@/lib/reports-products';
import { readProductDailyFloor } from '@/lib/reports-categories';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { buildBucketHistory, LabelDayTuple } from '@/lib/bucketsHistory';
import type { FeedProductInfo } from '@/lib/productsShaping';
import { parseTypeFilter } from '@/lib/productTypes';
import { lagCutoff } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_FLOOR = '2026-01-01'; // first day of the daily product table (PRODUCT_DAILY_FLOOR)

// GET /api/report/buckets?scope=<label>&start=&end=[&pt1=&pt2=]
// The product bucket view, shaped here from one row per product per day
// (src/lib/bucketsHistory.ts). The campaign matrix moved to Categories
//, so this route reads no campaign facts.
export async function GET(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  if (!DATE.test(start) || !DATE.test(end) || start > end) {
    return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 });
  }
  const accounts = resolveScope(await listAccounts(), url.searchParams.get('scope'));
  const ids = accounts.map(a => a.id);
  const range = { start, end };
  // The real first day in the table wins over the configured floor: if daily rows are
  // ever missing, the page starts where data starts instead of showing empty days.
  const floors = await Promise.all(ids.map(id => readProductDailyFloor(id)));
  const floor = [DAILY_FLOOR, ...floors.filter((f): f is string => !!f)].sort().pop()!;
  const productRange = { start: start < floor ? floor : start, end };

  const [labelDays, freshness, feed, excluded] = await Promise.all([
    productRange.start <= productRange.end
      ? getSupabaseAdmin().rpc('read_product_label_days_json', { p_account_ids: ids, p_start_date: productRange.start, p_end_date: productRange.end, p_platforms: platformsFromUrl(url) })
      : Promise.resolve({ data: [], error: null }),
    readFreshness(ids, platformsFromUrl(url)),
    readFeedProducts(ids),
    readTypeExclusions(ids),
  ]);
  assertOk(labelDays.error, 'Unable to read product label days');

  const history = buildBucketHistory({
    tuples: (labelDays.data || []) as LabelDayTuple[],
    feed: feed as FeedProductInfo[],
    start: productRange.start,
    end: productRange.end,
    filter: parseTypeFilter(url.searchParams.get('pt1'), url.searchParams.get('pt2')),
    excludedByDefault: excluded,
    // Switch effects use complete days only (the longest lag of the accounts in scope).
    lagCutoff: lagCutoff(Math.max(0, ...accounts.map(a => a.lag_days))),
  });

  return NextResponse.json({
    scope: url.searchParams.get('scope') || DEFAULT_SCOPE,
    accounts: accounts.map(a => ({ id: a.id, label: a.label, display_name: a.display_name, lag_days: a.lag_days })),
    range, productRange,
    history,
    freshness,
    role: session.user.role,
  });
}
