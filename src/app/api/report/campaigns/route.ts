import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { platformsFromUrl, targetsApply } from '@/lib/platform';
import { requireSession } from '@/lib/auth';
import { chooseGrain } from '@/lib/metrics';
import { resolveCompareRange } from '@/lib/compareRange';
import { readCampaignFacts, readConversionRoles, readFreshness, readTargets, Grain } from '@/lib/reports';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/report/campaigns?scope=all|<label>&start=&end=&compare=previous|year|none&grain=day|week|month
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
  const ids = accounts.map(a => a.id);
  const range = { start, end };
  const requestedGrain = url.searchParams.get('grain') as Grain | null;
  const grain: Grain = requestedGrain && ['day', 'week', 'month'].includes(requestedGrain) ? requestedGrain : chooseGrain(range);
  const compareRange = resolveCompareRange(url.searchParams, range);
  const platforms = platformsFromUrl(url);

  const [current, compare, roles, targets, freshness] = await Promise.all([
    readCampaignFacts(ids, range.start, range.end, grain, platforms),
    compareRange ? readCampaignFacts(ids, compareRange.start, compareRange.end, grain, platforms) : Promise.resolve([]),
    readConversionRoles(ids, range.start, range.end, grain, platforms),
    targetsApply(platforms[0]) ? readTargets(ids) : Promise.resolve([]),
    readFreshness(ids, platforms),
  ]);

  // Campaign tROAS / tCPA are Admin-only.
  const strip = (rows: typeof current) => (isAdmin ? rows : rows.map(r => ({ ...r, target_roas: null, target_cpa: null })));

  return NextResponse.json({
    scope: url.searchParams.get('scope') || 'all',
    accounts: accounts.map(a => ({ id: a.id, label: a.label, display_name: a.display_name, lag_days: a.lag_days })),
    range, compareRange, grain,
    rows: strip(current),
    compareRows: strip(compare),
    roles,
    targets,
    freshness,
    role: session.user.role,
  });
}
