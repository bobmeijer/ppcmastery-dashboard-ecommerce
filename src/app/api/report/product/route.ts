import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { platformsFromUrl } from '@/lib/platform';
import { requireSession } from '@/lib/auth';
import { readFeedProducts } from '@/lib/reports-feed';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { ProductDayRow } from '@/lib/productDetail';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/report/product?scope=<label>&id=<item id>&start=&end=
// One product for the panel on Products: its daily rows in the window
// (date x campaign x country x label, from 2026-01-01 on) and its current feed
// state (one row per feed label).
export async function GET(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  if (!id || !DATE.test(start) || !DATE.test(end) || start > end) {
    return NextResponse.json({ error: 'id, start and end (YYYY-MM-DD) are required' }, { status: 400 });
  }
  const accounts = resolveScope(await listAccounts(), url.searchParams.get('scope'));
  const ids = accounts.map(a => a.id);
  if (ids.length === 0) return NextResponse.json({ error: 'No matching account' }, { status: 400 });

  const [daily, feed] = await Promise.all([
    getSupabaseAdmin().rpc('read_product_daily_json', { p_account_ids: ids, p_item_id: id, p_start_date: start, p_end_date: end, p_platforms: platformsFromUrl(url) }),
    readFeedProducts(ids),
  ]);
  assertOk(daily.error, 'Unable to read product rows');

  return NextResponse.json({
    id,
    range: { start, end },
    rows: (daily.data || []) as ProductDayRow[],
    feed: feed.filter(f => f.item_id.toLowerCase() === id.toLowerCase()),
    role: session.user.role,
  });
}
