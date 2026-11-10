import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isSameOriginJson } from '@/lib/requestGuards';
import { parseNewUser } from '@/lib/userInput';
import { createUser, listUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';

// GET /api/admin/users: every dashboard user (no password hashes). Admin only.
export async function GET() {
  const session = await requireSession('admin');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ users: await listUsers(), me: session.user.id ?? null });
}

// POST /api/admin/users { email, name, role }: creates the user with a generated
// password, returned once in the response and never stored in plain text.
export async function POST(request: Request) {
  const session = await requireSession('admin');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSameOriginJson(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = parseNewUser(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await createUser(parsed.value);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
