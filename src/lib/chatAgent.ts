// The AI assistant chat: Claude Opus 5.5 answers questions
// about the current data view with the same read-only tools and account context as the
// analysis, and knows the analysis the reader sees. An AI assistant working with the account manager's
// approach, never the account manager. Numbers must come from the data it saw, the analysis or the
// conversation; a question it cannot answer, or one that asks for a decision or advice,
// it offers to put to the account manager.
import { ACCOUNTS, BRAND } from '@/lib/config';
import { withMethodology } from './methodology';
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { runToolLoop, type LoopUsage } from './claudeLoop';
import { corpusFact } from './insightAgent';
import { foreignNumbers } from './insightWriter';
import type { ToolContext } from './insightTools';
import type { SignalFact } from './insightSignals';

export const CHAT_MODEL = 'claude-opus-5-5';   // Opus on effort high, quality over speed
const MAX_TURNS = 8;
const MAX_HISTORY = 12;

const SYSTEM = `You are the AI assistant in the Google Ads and Microsoft Ads dashboard of ${BRAND.client}, with these accounts: ${ACCOUNTS.map(a => a.name).join(', ')}. The brief says which account and which ad platform (Google Ads or Microsoft Ads) the view shows. You are not the account manager and never speak as them. The reader is the client: smart, not a PPC specialist.

You answer questions about the data view the reader has open (account, period, comparison, filters). You know the AI analysis of that view; questions often follow up on it. Use the tools to look up what you need: campaign data by network, campaign, week or day, devices, countries, products, feed, Quality Score, auction insights, the account context (audit findings, standing notes, the account manager's notes) and the communication between the account manager and the client. Check account_context when a question is about why something happened.

How to answer:
- English, plain and short: two to five sentences, or a short list when that reads better. Lead with the answer.
- Answer exactly what was asked. A question about one campaign, network or metric gets that, not an analysis of the whole account, and no closing sentence about the rest of the account.
- A question whether something is seasonal: put this year's change next to the same months last year, both with their numbers, and say which is larger.
- A request that is not about the data (writing ads, texts, plans, anything outside the dashboard) gets one or two sentences: you answer questions about the figures, this is for the account manager, end with the marker line. No further analysis.
- Plain text only: no bold, headings or other markdown. A list is lines starting with "- ", separated by line breaks.
- Copy every number exactly as it appears in the tool results, the analysis or the conversation. Never compute, round or estimate a new number. If you need a number you do not have, fetch it or say you do not have it.
- "The goal" means the dashboard goals in the brief (per account: a ROAS goal, a CPA goal or purchases per month) and the goal pace in the computed signals, unless the reader names another target. The computed signals are the starting point for any question about the period.
- Revenue, ROAS, CVR and conversions are only complete up to the matured date in the view. For revenue questions use data up to that date (campaign_data gives the matured part separately); never present revenue or ROAS over unmatured days as a result, not even as a pace or projection. Do not quote those incomplete figures and do not say whether they will rise, fall or are a decline: say they are not complete yet and move on to what is.
- Missing data is not evidence: tools say from which date their data exists.
- A question about one campaign: pass its name (or a recognisable part) as campaign to the tools, so day, week, product, device and country figures are for that campaign only.
- Explaining what happened and why is your job. Decisions, strategy, budgets, targets and "what should we do" are the account manager's: say so in one sentence, then still look up and give the facts and causes that matter for that decision (so the reader comes to the account manager prepared), and end with the marker line. Give no conclusion, weighing or direction of your own on such a decision (not "it is mostly about X, not Y", not "budget is not what holds it back"): give the figure itself (budget-lost IS 0.00%), never what it means for the decision; the weighing is the account manager's. Never say you will pass it on yourself: the reader can put the question to the account manager with the button under your answer.
- Also end with the marker line when you cannot answer reliably with the data you have. Never on a factual question you did answer (what happened, when, where, why, which changes, who): those stay with you.
- The marker line: when the question is the account manager's to answer, the very last line of your answer is exactly [question-for-admin] and nothing else. Otherwise leave it out.
- The brief says who reads: the client, or the account manager himself. For the account manager all tools are open, including change_history; use it when he asks about changes.
- No profit, margin, POAS or break-even. No em dashes or en dashes. Never name people other than the account manager. Write dates the English way (17 August, week of 7 September).
- the account manager's corrections of earlier analyses, when given, show how he wants this written: follow the lessons in his notes and versions. Never copy numbers from them; they belong to other periods.`;

// Plain text so the answer can stream; the last line flags a question for the account manager.
const MARKER = '[question-for-admin]';

export interface ChatTurn { role: 'user' | 'assistant'; text: string }
export interface ChatResult {
  answer: string; suggestAdmin: boolean; source: 'ai' | 'fallback'; costUsd: number;
  model: string | null; usage: LoopUsage; turns: number; transcript: Anthropic.Beta.BetaMessageParam[];   // for the eval
}

const FALLBACK = "I can't answer this question reliably right now. Would you like to ask the account manager?";

// Streams the answer as it is written: onDelta gets text, onReset clears what was sent
// (text before a tool call, or an attempt the number check rejects). The marker is held
// back so it never shows; the final ChatResult is what counts.
export async function runChat({ ctx, brief, signals, analysis, corrections = '', history, question, onStep, onDelta, onReset }: {
  ctx: ToolContext; brief: string; signals: SignalFact[]; analysis: string; corrections?: string; history: ChatTurn[]; question: string;
  onStep?: (label: string) => void; onDelta?: (text: string) => void; onReset?: () => void;
}): Promise<ChatResult> {
  let buffer = '';
  let sent = 0;
  const hold = MARKER.length + 2;
  const flush = () => { if (buffer.length - hold > sent) { onDelta?.(buffer.slice(sent, buffer.length - hold)); sent = buffer.length - hold; } };
  const reset = () => { if (sent > 0) onReset?.(); buffer = ''; sent = 0; };
  const past = history.slice(-MAX_HISTORY);
  const facts = signals.map(({ severity, subject, metric, from, to, delta, context }) => ({ severity, subject, metric, from, to, delta, context }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `${brief}\n\nComputed signals for this view:\n${JSON.stringify(facts)}\n\nAI analysis the reader sees:\n${analysis || '(no analysis yet)'}${corrections ? `\n\nthe account manager's corrections of earlier analyses of this account:\n${corrections}` : ''}` },
    { role: 'assistant', content: 'Understood. I will answer questions about this view.' },
    ...past.map(t => ({ role: t.role, content: t.text }) as Anthropic.Beta.BetaMessageParam),
    { role: 'user', content: question },
  ];
  const known = `${brief}\n${JSON.stringify(facts)}\n${analysis}\n${past.map(t => t.text).join('\n')}\n${question}`;
  let cost = 0;
  let model: string | null = null;
  let turns = 0;
  const usage: LoopUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const extra = () => ({ model, usage, turns, transcript: messages });
  // Data fetched in an earlier attempt still counts: a retry usually does not fetch again.
  let seen = '';
  // One retry when the answer uses a number the data does not contain.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    reset();
    const { parsed, corpus, costUsd, model: m, usage: u, turns: n } = await runToolLoop<string>({
      model: CHAT_MODEL, effort: 'high', fast: true, system: withMethodology(SYSTEM), ctx, maxTurns: MAX_TURNS, onStep, messages,
      onText: delta => { buffer += delta; flush(); }, onReset: reset,
    });
    cost += costUsd;
    seen += corpus;
    model = m ?? model;
    turns += n;
    for (const k of Object.keys(usage) as (keyof LoopUsage)[]) usage[k] += u[k];
    if (!parsed) break;
    // Plain text for the panel: no markdown emphasis; the marker becomes the flag.
    const suggestAdmin = parsed.includes(MARKER);
    const answer = parsed.replace(MARKER, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
    const foreign = foreignNumbers(answer, corpusFact(`${known}\n${seen}`));
    if (foreign.length === 0) return { answer, suggestAdmin, source: 'ai', costUsd: cost, ...extra() };
    console.error(`chat: attempt ${attempt + 1} used numbers not in the data: ${foreign.join(', ')}`);
    // Second miss: keep the sentences that pass, when enough of the answer is left.
    if (attempt === 1) {
      const allowed = corpusFact(`${known}\n${seen}`);
      const kept = answer.split(/(?<=[.!?])\s+|\n/).filter(s => s.trim() && foreignNumbers(s, allowed).length === 0);
      const text = kept.join(' ').trim();
      if (text.length >= answer.length * 0.6) return { answer: text, suggestAdmin, source: 'ai', costUsd: cost, ...extra() };
    }
    messages.push({ role: 'user', content: `Your answer contains numbers that do not appear literally in the data, the analysis or the conversation (${foreign.join(', ')}). Give the answer again using only numbers you have seen literally like that, or without those numbers.` });
  }
  return { answer: FALLBACK, suggestAdmin: true, source: 'fallback', costUsd: cost, ...extra() };
}
