import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isSameOriginJson } from '@/lib/requestGuards';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { ActionStatus } from '@/lib/meetingsShaping';

export const dynamic = 'force-dynamic';

const STATUSES: ActionStatus[] = ['open', 'done', 'dropped'];

// POST /api/report/meetings/status { id, status }: both roles may change an action's status.
export async function POST(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSameOriginJson(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  const status = body?.status as ActionStatus;
  if (!id || id.length > 200 || !STATUSES.includes(status)) return NextResponse.json({ error: 'Unknown action or status.' }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc('set_action_status', {
    p_id: id, p_status: status, p_changed_by: session.user.email || session.user.id,
  });
  assertOk(error, 'set_action_status');
  if (!data) return NextResponse.json({ error: 'Action not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
