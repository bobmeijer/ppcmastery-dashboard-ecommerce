import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isSameOriginJson } from '@/lib/requestGuards';
import { escalateChat } from '@/lib/chatLog';
import { mailEscalation } from '@/lib/mail';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/;

// POST /api/chat/escalate  { questionId }: "Ask the account manager" flags the reader's own
// question in the chat log and mails it to Admin with the answer and the view. The flag is
// what counts: a mail that fails is logged, the reader still sees it was passed on.
export async function POST(request: Request) {
  const session = await requireSession('client');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isSameOriginJson(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => null) as { questionId?: unknown } | null;
  const id = typeof body?.questionId === 'string' && UUID.test(body.questionId) ? body.questionId : null;
  if (!id) return NextResponse.json({ error: 'questionId is required' }, { status: 400 });
  const escalation = await escalateChat(id, session.user.email ?? '');
  if (!escalation) return NextResponse.json({ error: 'Could not pass on the question' }, { status: 503 });
  // Already with Admin: no second mail.
  if (escalation === 'already') return NextResponse.json({ ok: true, mailed: true });
  let mailed = true;
  try {
    await mailEscalation(escalation, session.user.name || escalation.userEmail);
  } catch (error) {
    mailed = false;
    console.error(`chat escalate mail: ${error instanceof Error ? error.message : String(error)}`);
  }
  return NextResponse.json({ ok: true, mailed });
}
