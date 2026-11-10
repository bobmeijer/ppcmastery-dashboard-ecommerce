import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isSameOriginJson } from '@/lib/requestGuards';
import { assertOk, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// POST /api/report/meetings/hidden { id, hidden }: admins hide or show one timeline item.
// Hiding also hides its actions from the client; the next publish keeps the flag.
export async function POST(request: Request) {
  const session = await requireSession('admin');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSameOriginJson(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id || id.length > 200 || typeof body?.hidden !== 'boolean') return NextResponse.json({ error: 'Unknown item.' }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc('set_communication_hidden', {
    p_id: id, p_hidden: body.hidden, p_changed_by: session.user.email || session.user.id,
  });
  assertOk(error, 'set_communication_hidden');
  if (!data) return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
