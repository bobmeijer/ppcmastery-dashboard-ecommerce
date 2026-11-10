import { requireSession } from '@/lib/auth';
import { isSameOriginJson } from '@/lib/requestGuards';
import { readView } from '@/lib/insightView';
import { type ChatTurn } from '@/lib/chatAgent';
import { answerChat } from '@/lib/chatRun';
import { logChat } from '@/lib/chatLog';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MAX_TEXT = 2000;

// POST /api/chat?scope=&start=&end=&compare=&compareStart=&compareEnd=&campaigns=&networks=&brand=&status=
// Body: { threadId, question, history: [{ role, text }], analysis }. Answers as NDJSON:
// {"step": ...} lines while the assistant looks things up, {"delta": text} while it writes
// ({"reset": true} discards what was streamed), then {"result": { answer, suggestAdmin, logged, questionId }}.
export async function POST(request: Request) {
  const session = await requireSession('client');
  if (!session) return json({ error: 'Unauthorized' }, 401);
  if (!isSameOriginJson(request)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
  const isAdmin = session.user.role === 'admin';
  const view = await readView(new URL(request.url).searchParams);
  if ('error' in view) return json({ error: view.error }, 400);

  const body = await request.json().catch(() => null) as { threadId?: unknown; question?: unknown; history?: unknown; analysis?: unknown } | null;
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, MAX_TEXT) : '';
  const threadId = typeof body?.threadId === 'string' && /^[\w-]{8,64}$/.test(body.threadId) ? body.threadId : null;
  if (!question || !threadId) return json({ error: 'question and threadId are required' }, 400);
  const history: ChatTurn[] = (Array.isArray(body?.history) ? body.history : [])
    .filter((t): t is ChatTurn => !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
    .map(t => ({ role: t.role, text: t.text.slice(0, MAX_TEXT) }));
  const analysis = typeof body?.analysis === 'string' ? body.analysis.slice(0, 4000) : '';

  const userEmail = session.user.email ?? 'unknown';
  const viewLog = { range: view.range, compareRange: view.compareRange, filters: view.filters, platform: view.platform };
  const encoder = new TextEncoder();
  const line = (o: unknown) => encoder.encode(`${JSON.stringify(o)}\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const questionId = await logChat({ threadId, userEmail, role: 'user', accountLabel: view.account.label, view: viewLog, text: question });
        const result = await answerChat({
          view, isAdmin, question, history, analysis,
          onStep: step => controller.enqueue(line({ step })),
          onDelta: delta => controller.enqueue(line({ delta })),
          onReset: () => controller.enqueue(line({ reset: true })),
        });
        const answerId = await logChat({ threadId, userEmail, role: 'assistant', accountLabel: view.account.label, view: viewLog, text: result.answer, source: result.source });
        controller.enqueue(line({ result: { answer: result.answer, suggestAdmin: result.suggestAdmin, logged: !!(questionId && answerId), questionId, answerId } }));
      } catch (error) {
        controller.enqueue(line({ error: error instanceof Error ? error.message : String(error) }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
}
