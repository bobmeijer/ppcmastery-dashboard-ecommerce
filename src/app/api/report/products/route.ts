import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { platformsFromUrl } from '@/lib/platform';
import { requireSession } from '@/lib/auth';
import { readProductFreshness, readProductsReport } from '@/lib/reports-products';
import { parseTypeFilter } from '@/lib/productTypes';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/report/products?scope=<label>&start=&end=[&pt1=&pt2=]
// Aggregated server-side: the browser never sees the raw product x campaign x country rows.
// pt1 / pt2 = product type filter (src/lib/productTypes.ts); absent = the account default.
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
  const filter = parseTypeFilter(url.searchParams.get('pt1'), url.searchParams.get('pt2'));

  const [report, freshness] = await Promise.all([
    readProductsReport(ids, start, end, filter, platformsFromUrl(url)),
    readProductFreshness(ids, platformsFromUrl(url)),
  ]);

  return NextResponse.json({
    scope: url.searchParams.get('scope') || 'all',
    accounts: accounts.map(a => ({ id: a.id, label: a.label, display_name: a.display_name, lag_days: a.lag_days })),
    range: { start, end },
    freshness,
    role: session.user.role,
    ...report,
  });
}
