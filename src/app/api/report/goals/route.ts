import { NextResponse } from 'next/server';
import { listAccounts, resolveScope } from '@/lib/accounts';
import { requireSession } from '@/lib/auth';
import { goalsFor } from '@/lib/goals';
import { readTargets } from '@/lib/reports';

export const dynamic = 'force-dynamic';

// GET /api/report/goals?scope=<label>
// The monthly revenue and ROAS goals for one account, from the targets table. They come
// through this route because anything in dashboard.config.ts is public.
export async function GET(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = new URL(request.url).searchParams.get('scope');
  const [account] = scope ? resolveScope(await listAccounts(), scope) : [];
  if (!account) return NextResponse.json({ goals: null });

  const today = new Date().toISOString().slice(0, 10);
  const found = goalsFor(await readTargets([account.id]), account.id, today);
  const goals = found?.revenuePerMonth != null && found.roas != null ? { revenuePerMonth: found.revenuePerMonth, roas: found.roas } : null;
  return NextResponse.json({ goals });
}
