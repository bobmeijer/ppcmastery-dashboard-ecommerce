// One analysis for one view and role: the stored one, or a fresh agent run that is then
// stored. Shared by /api/insights (on demand, streamed) and the nightly prewarm cron.
import 'server-only';
import { AGENT_MODEL, runAgent } from './insightAgent';
import { contextVersion, viewBrief, viewSignals, type View } from './insightView';
import { readCorrections, readInsight, saveInsight, viewKey, type Role, type StoredInsight } from './insightStore';

export async function insightKey(page: string, view: View, role: Role) {
  return viewKey(page, view, role, await contextVersion(view.account.label));
}

// fast: Opus fast mode for a reader who is waiting; the nightly prewarm runs at standard speed.
export async function runInsight(page: string, view: View, role: Role, opts: { fresh?: boolean; fast?: boolean; onStep?: (step: string) => void } = {}): Promise<{ insight: StoredInsight; ran: boolean }> {
  const { key, view: keyView } = await insightKey(page, view, role);
  if (!opts.fresh) {
    const stored = await readInsight(key);
    if (stored) return { insight: stored, ran: false };
  }
  const [{ facts, names }, corrections] = await Promise.all([viewSignals(view), readCorrections(view.account.label, role)]);
  const result = await runAgent({
    ctx: { account: view.account, filters: view.filters, isAdmin: role === 'admin', platform: view.platform, maturedEnd: view.maturedEnd },
    facts,
    brief: viewBrief(view, names),
    onStep: opts.onStep,
    fast: opts.fast,
    corrections,
  });
  // The plain fallback (cap reached, no key) costs nothing to redo: never stored, so it
  // neither fills the table nor blocks a real analysis once the cap resets.
  if (result.source !== 'ai') {
    return { insight: { key, story: result.story, status: 'auto', source: result.source, model: null, generatedAt: new Date().toISOString() }, ran: true };
  }
  const insight = await saveInsight({ key, accountLabel: view.account.label, role, view: keyView, story: result.story, source: result.source, model: AGENT_MODEL, costUsd: result.costUsd });
  return { insight, ran: true };
}
