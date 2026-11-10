import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isSameOriginJson } from '@/lib/requestGuards';
import { rateChat } from '@/lib/chatLog';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/;

// POST /api/chat/rate  { answerId, rating: 1 | -1, note? }: the reader rates an answer.
export async function POST(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSameOriginJson(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => null) as { answerId?: unknown; rating?: unknown; note?: unknown } | null;
  const id = typeof body?.answerId === 'string' && UUID.test(body.answerId) ? body.answerId : null;
  const rating = body?.rating === 1 || body?.rating === -1 ? body.rating : null;
  if (!id || !rating) return NextResponse.json({ error: 'answerId and rating are required' }, { status: 400 });
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  return (await rateChat(id, session.user.email ?? '', rating, note))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Could not save the rating' }, { status: 503 });
}
