import { DEFAULT_SCOPE } from '@/lib/config';
import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { requireSession } from '@/lib/auth';
import { AuctionGrain, AuctionNetwork, NETWORKS } from '@/lib/auctionShaping';
import { auctionWatchlist, readAuctionCategories, readAuctionCoverage, readAuctionInsights } from '@/lib/reports-auction';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;   // matches the statement timeout of the read functions

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GRAINS: AuctionGrain[] = ['day', 'week', 'month'];

// GET /api/report/auction?scope=<label>&start=&end=&grain=day|week|month
//     [&network=Search|Shopping][&category=...][&compare_start=&compare_end=]
// Auction insights for one network and category: rows per period (grain),
// totals over the whole period and, with a comparison period, its totals too.
// Without network / category the biggest category of Search is used; the
// response says which one it picked.
export async function GET(request: Request) {
  try {
    return await report(request);
  } catch (err) {
    // An uncaught throw becomes a 500 with an empty body, which the page cannot parse.
    console.error(err);
    return NextResponse.json({ error: 'The data is temporarily unavailable. Please try again.' }, { status: 500 });
  }
}

async function report(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const accounts = resolveScope(await listAccounts(), url.searchParams.get('scope') || DEFAULT_SCOPE);
  if (accounts.length !== 1) return NextResponse.json({ error: 'scope must be one account label' }, { status: 400 });
  const account = accounts[0];
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  if (!DATE.test(start) || !DATE.test(end) || start > end) return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 });
  const grain = (GRAINS.find(g => g === url.searchParams.get('grain')) ?? 'week') as AuctionGrain;
  const compareStart = url.searchParams.get('compare_start');
  const compareEnd = url.searchParams.get('compare_end');
  const ids = [account.id];

  const [coverage, categoryRows] = await Promise.all([readAuctionCoverage(ids), readAuctionCategories(ids, start, end)]);
  const categories: Record<AuctionNetwork, string[]> = { Search: [], Shopping: [] };
  for (const c of categoryRows) categories[c.network].push(c.category);

  const askedNetwork = NETWORKS.find(n => n === url.searchParams.get('network')) ?? 'Search';
  const network: AuctionNetwork = categories[askedNetwork].length ? askedNetwork : (NETWORKS.find(n => categories[n].length) ?? askedNetwork);
  const askedCategory = url.searchParams.get('category');
  const category = askedCategory && categories[network].includes(askedCategory) ? askedCategory : categories[network][0] ?? null;

  const base = {
    scope: account.label,
    account: { id: account.id, label: account.label, display_name: account.display_name, lag_days: account.lag_days },
    watchlist: auctionWatchlist(account.label),
    coverage, categories, network, category, grain,
    role: session.user.role,
  };
  if (!category) return NextResponse.json({ ...base, rows: [], totals: [], compare_totals: null });

  const withCompare = compareStart && compareEnd && DATE.test(compareStart) && DATE.test(compareEnd);
  const [rows, totals, compareTotals] = await Promise.all([
    readAuctionInsights(ids, start, end, grain, network, category),
    readAuctionInsights(ids, start, end, 'all', network, category),
    withCompare ? readAuctionInsights(ids, compareStart!, compareEnd!, 'all', network, category) : Promise.resolve(null),
  ]);
  return NextResponse.json({ ...base, rows, totals, compare_totals: compareTotals });
}
