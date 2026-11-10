import { requireSession } from '@/lib/auth';
import { DEMO_MODE } from '@/lib/demoMode';
import { isSameOriginJson } from '@/lib/requestGuards';
import { readView } from '@/lib/insightView';
import { editInsight, readInsight, type InsightStatus, type Role, type Story } from '@/lib/insightStore';
import { insightKey, runInsight } from '@/lib/insightRun';
import type { Source } from '@/lib/insightSources';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // the agent takes 20 to 60 seconds

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const asBody = (s: { key: string; story: Story; status: InsightStatus; source: string; model: string | null; generatedAt: string }, role: Role) => ({
  insight: { id: s.key, page: 'overview', status: s.status, generatedAt: s.generatedAt, story: s.story },
  source: s.source, model: s.model, role,
});

// POST /api/insights?page=overview&fresh=1&as=client&scope=&start=&end=&compare=&compareStart=&compareEnd=&campaigns=&networks=&brand=&status=
// Stored per view (insightStore.ts). A stored analysis answers at once; otherwise NDJSON:
// {"step": ...} lines while the agent works, then {"result": {...}}. The client role gets
// the client analysis; Admin gets his own, or with as=client exactly what the client sees,
// which is the one he edits or withdraws.
// POST, same-origin JSON only: opening the URL from another site must never start a paid run.
export async function POST(request: Request) {
  const session = await requireSession('client');
  if (!session) return json({ error: 'Unauthorized' }, 401);
  if (!isSameOriginJson(request)) return json({ error: 'Forbidden' }, 403);
  const isAdmin = session.user.role === 'admin';

  const url = new URL(request.url);
  const page = url.searchParams.get('page');
  if (page !== 'overview') return json({ error: 'Unknown page' }, 400);
  const view = await readView(url.searchParams);
  if ('error' in view) return json({ error: view.error }, 400);
  const role: Role = isAdmin && url.searchParams.get('as') !== 'client' ? 'admin' : 'client';

  // New account context (audit findings, notes) makes a new key: the stored story is redone.
  const { key } = await insightKey(page, view, role);
  const encoder = new TextEncoder();
  const line = (o: unknown) => encoder.encode(`${JSON.stringify(o)}\n`);
  const ndjson = (o: unknown) => new Response(line(o), { headers: { 'content-type': 'application/x-ndjson' } });
  // Admin can force a fresh run ("Re-run analysis"); everyone else reads the stored one.
  const fresh = url.searchParams.get('fresh') === '1' && isAdmin && !DEMO_MODE;
  const stored = fresh ? null : await readInsight(key);
  if (stored) {
    // A withdrawn analysis is not sent to the client at all.
    if (stored.status === 'hidden' && !isAdmin) return ndjson({ result: { insight: null, hidden: true } });
    return ndjson({ result: asBody(stored, role) });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { insight: saved } = await runInsight(page, view, role, { fresh: true, fast: true, onStep: step => controller.enqueue(line({ step })) });
        if (saved.status === 'hidden' && !isAdmin) controller.enqueue(line({ result: { insight: null, hidden: true } }));
        else controller.enqueue(line({ result: asBody(saved, role) }));
      } catch (error) {
        controller.enqueue(line({ error: error instanceof Error ? error.message : String(error) }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
}

// The sources of an edited point come back from the editor: keep only well-formed ones.
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
function cleanSources(raw: unknown): Source[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).flatMap((s): Source[] => {
    if (s?.kind === 'context' && typeof s.text === 'string') return [{ kind: 'context', source: str(s.source, 120), date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : null, text: str(s.text, 2000) }];
    if (s?.kind === 'data' && typeof s.label === 'string') {
      const path = typeof s.path === 'string' && /^\/[a-z-]+$/.test(s.path) ? s.path : undefined;
      const params = path && s.params && typeof s.params === 'object' ? Object.fromEntries(Object.entries(s.params as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.slice(0, 20), (v as string).slice(0, 100)])) : undefined;
      return [{ kind: 'data', label: str(s.label, 200), ...(path ? { path, ...(params ? { params } : {}) } : {}) }];
    }
    return [];
  });
}

// PATCH /api/insights { key, status?, story?, note? }: Admin edits or withdraws a stored
// analysis; the note says what the AI should learn from it (readCorrections).
export async function PATCH(request: Request) {
  const session = await requireSession('admin');
  if (!session) return json({ error: 'Unauthorized' }, 401);
  if (!isSameOriginJson(request)) return json({ error: 'Forbidden' }, 403);
  const body = await request.json().catch(() => null) as { key?: unknown; status?: unknown; story?: unknown; note?: unknown } | null;
  const key = typeof body?.key === 'string' && /^[0-9a-f]{64}$/.test(body.key) ? body.key : null;
  const status = body?.status === 'auto' || body?.status === 'hidden' || body?.status === 'approved' ? body.status : undefined;
  const raw = body?.story as Story | undefined;
  const story = raw && typeof raw.headline === 'string' && Array.isArray(raw.points)
    ? { headline: raw.headline.slice(0, 600), points: raw.points.filter(p => p && typeof p.text === 'string').slice(0, 6).map(p => {
      const sources = cleanSources(p.sources);
      return { text: p.text.slice(0, 600), type: p.type === 'interpretation' ? 'interpretation' as const : 'fact' as const, ...(p.link ? { link: p.link } : {}), ...(sources.length ? { sources } : {}) };
    }) }
    : undefined;
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : undefined;
  if (!key || (!status && !story && note === undefined)) return json({ error: 'key and status, story or note are required' }, 400);
  const saved = await editInsight(key, { status, story, note }, session.user.email ?? 'admin');
  return saved ? json({ insight: asBody(saved, 'client').insight }) : json({ error: 'Not found' }, 404);
}
