import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/requestGuards';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { addDays, accountToday, isoDate } from '@/lib/metrics';
import { readView } from '@/lib/insightView';
import { runInsight } from '@/lib/insightRun';
import type { Role } from '@/lib/insightStore';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// GET /api/cron/insights[?accounts=label,label][&roles=client,admin]
// Daily Vercel cron after the data syncs: computes the AI analysis of the default view
// (Last month against the previous period, no filters) so the first reader of the day
// gets it at once. Client version only by default: that is what the clients open, and
// Admin's own version follows when he opens it. A stored analysis is not redone, so a
// stable (fully matured) month costs nothing after its first run.
export async function GET(request: Request) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const all = await listAccounts();
  const scope = url.searchParams.get('accounts');
  const accounts = scope ? scope.split(',').flatMap(s => resolveScope(all, s.trim())) : all;
  const roles = (url.searchParams.get('roles') || 'client').split(',').filter((r): r is Role => r === 'client' || r === 'admin');

  // Same range as the Last month preset in the top bar.
  const today = accountToday();
  const start = isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
  const end = addDays(isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), -1);

  const results: { account: string; role: Role; ran: boolean; source: string }[] = [];
  const errors: { account: string; error: string }[] = [];
  for (const account of accounts) {
    const view = await readView(new URLSearchParams({ scope: account.label, preset: 'lastmonth', start, end, compare: 'previous' }));
    if ('error' in view) { errors.push({ account: account.label, error: view.error }); continue; }
    for (const role of roles) {
      try {
        const { insight, ran } = await runInsight('overview', view, role);
        results.push({ account: account.label, role, ran, source: insight.source });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Insight prewarm failed for ${account.label}: ${message}`);
        errors.push({ account: account.label, error: message });
      }
    }
  }
  const ok = errors.length === 0;
  return NextResponse.json({ dataset: 'insights', ok, results, errors }, { status: ok ? 200 : 500 });
}
