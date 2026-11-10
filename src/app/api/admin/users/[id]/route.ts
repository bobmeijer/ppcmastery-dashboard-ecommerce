import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isSameOriginJson } from '@/lib/requestGuards';
import { deleteUser, resetPassword } from '@/lib/users';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/admin/users/<id> { action: 'reset' }: new generated password, returned once.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const session = await requireSession('admin');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSameOriginJson(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Unknown user.' }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  if (body?.action !== 'reset') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const password = await resetPassword(params.id);
  if (!password) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  return NextResponse.json({ password }, { headers: { 'Cache-Control': 'no-store' } });
}

// DELETE /api/admin/users/<id>: removes the user; never yourself, never the last admin.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const session = await requireSession('admin');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSameOriginJson(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Unknown user.' }, { status: 400 });
  if (params.id === session.user.id) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  const result = await deleteUser(params.id);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
