import { DEFAULT_SCOPE } from '@/lib/config';
import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { platformsFromUrl, targetsApply } from '@/lib/platform';
import { requireSession } from '@/lib/auth';
import { chooseGrain } from '@/lib/metrics';
import { resolveCompareRange } from '@/lib/compareRange';
import { readTargets, Grain } from '@/lib/reports';
import { readGeoFacts, readGeoFreshness } from '@/lib/reports-geo';
import { beVsNlFinding, countrySummaries } from '@/lib/geoShaping';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/report/geo?scope=<label>&start=&end=&compare=previous|year|none&grain=day|week|month
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
  const scope = url.searchParams.get('scope') || DEFAULT_SCOPE;
  const accounts = resolveScope(await listAccounts(), scope);
  const ids = accounts.map(a => a.id);
  const range = { start, end };
  const requestedGrain = url.searchParams.get('grain') as Grain | null;
  const grain: Grain = requestedGrain && ['day', 'week', 'month'].includes(requestedGrain) ? requestedGrain : chooseGrain(range);
  const compareRange = resolveCompareRange(url.searchParams, range);
  const platforms = platformsFromUrl(url);

  const [rows, compareRows, targets, freshness] = await Promise.all([
    readGeoFacts(ids, range.start, range.end, grain, platforms),
    compareRange ? readGeoFacts(ids, compareRange.start, compareRange.end, grain, platforms) : Promise.resolve([]),
    targetsApply(platforms[0]) ? readTargets(ids) : Promise.resolve([]),
    readGeoFreshness(ids, platforms),
  ]);

  // The BE-versus-NL finding is Admin-only: computed here for admins, never sent to the client role.
  const summaries = countrySummaries(rows, compareRows);
  const finding = isAdmin ? beVsNlFinding(summaries.NL, summaries.BE) : null;

  return NextResponse.json({
    scope,
    accounts: accounts.map(a => ({ id: a.id, label: a.label, display_name: a.display_name, lag_days: a.lag_days })),
    range, compareRange, grain,
    rows, compareRows,
    targets,
    freshness,
    finding,
    role: session.user.role,
  });
}
