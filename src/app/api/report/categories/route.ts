import { accountConfig } from '@/lib/config';
import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { platformsFromUrl, targetsApply } from '@/lib/platform';
import { requireSession } from '@/lib/auth';
import { chooseGrain } from '@/lib/metrics';
import { resolveCompareRange } from '@/lib/compareRange';
import { readCampaignFacts, readFreshness, readTargets, Grain } from '@/lib/reports';
import { readProductTypeReport } from '@/lib/reports-categories';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// An account can take its category view from product types instead of campaign
// names (categoriesFromProductTypes in dashboard.config.ts). The switch is
// data-driven on top of that: once the account runs more than one
// campaign category, the campaign view takes over by itself.

// GET /api/report/categories?scope=<label>&start=&end=&compare=previous|year|none&grain=day|week|month
export async function GET(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = session.user.role === 'admin';

  const url = new URL(request.url);
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  if (!DATE.test(start) || !DATE.test(end) || start > end) {
    return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 });
  }
  const accounts = resolveScope(await listAccounts(), url.searchParams.get('scope'));
  if (accounts.length !== 1) return NextResponse.json({ error: 'scope must name one label' }, { status: 400 });
  const account = accounts[0];
  const range = { start, end };
  const requestedGrain = url.searchParams.get('grain') as Grain | null;
  const grain: Grain = requestedGrain && ['day', 'week', 'month'].includes(requestedGrain) ? requestedGrain : chooseGrain(range);
  const compareRange = resolveCompareRange(url.searchParams, range);
  const platforms = platformsFromUrl(url);

  const [current, compare, targets, freshness] = await Promise.all([
    readCampaignFacts([account.id], range.start, range.end, grain, platforms),
    compareRange ? readCampaignFacts([account.id], compareRange.start, compareRange.end, grain, platforms) : Promise.resolve([]),
    targetsApply(platforms[0]) ? readTargets([account.id]) : Promise.resolve([]),
    readFreshness([account.id], platforms),
  ]);

  const categories = new Set(current.map(r => r.category));
  const mode = accountConfig(account.label)?.categoriesFromProductTypes && categories.size <= 1 ? 'product' : 'campaign';
  const products = mode === 'product' ? await readProductTypeReport(account.id, range, compareRange, platforms) : null;

  // Campaign tROAS / tCPA are Admin-only.
  const strip = (rows: typeof current) => (isAdmin ? rows : rows.map(r => ({ ...r, target_roas: null, target_cpa: null })));

  return NextResponse.json({
    scope: account.label,
    accounts: accounts.map(a => ({ id: a.id, label: a.label, display_name: a.display_name, lag_days: a.lag_days })),
    range, compareRange, grain, mode,
    rows: strip(current),
    compareRows: strip(compare),
    products,
    targets,
    freshness,
    role: session.user.role,
  });
}
