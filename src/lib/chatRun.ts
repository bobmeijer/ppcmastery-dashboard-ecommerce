// One chat answer for a view: the signals, goals and Admin's corrections around the
// question, then the chat agent. Shared by /api/chat and the chat eval (evals/chat), so
// the eval exercises exactly what production runs.
import 'server-only';
import { DEMO_MODE } from './demoMode';
import { fmtCount, fmtCurrency, fmtRatio } from './metrics';
import { viewBrief, viewSignals, type View } from './insightView';
import { readCorrections } from './insightStore';
import { runChat, type ChatResult, type ChatTurn } from './chatAgent';

export async function answerChat({ view, isAdmin, question, history, analysis, onStep, onDelta, onReset }: {
  view: View; isAdmin: boolean; question: string; history: ChatTurn[]; analysis: string;
  onStep?: (step: string) => void; onDelta?: (text: string) => void; onReset?: () => void;
}): Promise<ChatResult> {
  // Demo: pre-generated answers for the suggested questions. A hosted demo never calls the
  // API, even with a key set, because it has no login in front of it.
  if (DEMO_MODE && (process.env.NODE_ENV === 'production' || !process.env.ANTHROPIC_API_KEY)) {
    const { replayAnswer, replayShift } = require('./demo/replay') as typeof import('./demo/replay');
    const answer = replayAnswer(view.account.label, question, { shift: replayShift() });
    onDelta?.(answer);
    return { answer, suggestAdmin: false, source: 'ai', costUsd: 0, model: null, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, turns: 0, transcript: [] };
  }
  // Corrections hold the original AI text and private notes, so a client's chat never gets them.
  const [{ facts, goals, names }, corrections] = await Promise.all([viewSignals(view), isAdmin ? readCorrections(view.account.label, 'admin') : Promise.resolve('')]);
  const parts = goals ? [
    goals.revenuePerMonth !== null ? `revenue ${fmtCurrency(goals.revenuePerMonth)} per month` : '',
    goals.purchasesPerMonth !== null ? `${fmtCount(goals.purchasesPerMonth)} purchases per month` : '',
    goals.roas !== null ? `a ROAS goal of ${fmtRatio(goals.roas)}` : '',
    goals.cpa !== null ? `a CPA goal of ${fmtCurrency(goals.cpa, 2)}` : '',
  ].filter(Boolean) : [];
  const goalLine = parts.length ? `Goals in the dashboard: ${parts.join(', ')}.` : 'No dashboard goals for this view (filters active, Microsoft Ads or no goal set).';
  return runChat({
    ctx: { account: view.account, filters: view.filters, isAdmin, platform: view.platform, maturedEnd: view.maturedEnd },
    brief: `${viewBrief(view, names)}\n${goalLine}\nReader: ${isAdmin ? 'Admin himself (admin); all tools are available, including change_history.' : 'the client.'}`, signals: facts, analysis, corrections, history, question, onStep, onDelta, onReset,
  });
}
