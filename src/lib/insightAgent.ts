// AI analysis agent: Claude Opus 5.5 gets the
// computed signals as a starting point, digs with the read-only tools in insightTools.ts
// and writes one story: a headline plus 3-4 points of evidence, interpretation labelled.
// Every number in the text must come from the evidence or a tool result, else the point
// is dropped; when nothing usable comes back the computed signals are shown as they are.
import { ACCOUNTS, BRAND, moduleEnabled } from '@/lib/config';
import type { ModuleKey } from '../../dashboard.config';
import 'server-only';
import { runToolLoop } from './claudeLoop';
import type { ToolContext } from './insightTools';
import { fallbackSignal, usesOnlyFactNumbers } from './insightWriter';
import type { SignalFact } from './insightSignals';
import { resolveSources, type Source } from './insightSources';

export const AGENT_MODEL = 'claude-opus-5-5';
const MAX_TURNS = 10;

export const LINK_PAGES = { trends: '/trends', campaigns: '/campaigns', products: '/products', feed: '/feed', 'quality-score': '/quality-score', auction: '/auction', devices: '/devices', countries: '/countries' } as const;
const MODULE_PAGES: Partial<Record<keyof typeof LINK_PAGES, ModuleKey>> = { feed: 'feedStatus', 'quality-score': 'qualityScore', auction: 'auctionInsights' };
const linkPages = (Object.keys(LINK_PAGES) as (keyof typeof LINK_PAGES)[]).filter(page => { const key = MODULE_PAGES[page]; return !key || moduleEnabled(key); });
type LinkPage = keyof typeof LINK_PAGES | 'none';

export interface StoryPoint { text: string; type: 'fact' | 'interpretation'; link?: { path: string }; sources?: Source[] }
export interface Story { headline: string; points: StoryPoint[] }
export interface AgentResult { story: Story; source: 'ai' | 'fallback'; costUsd: number }

const SYSTEM = `You are the analyst behind the AI analysis panel of the Google Ads and Microsoft Ads dashboard of ${BRAND.client}, with these accounts: ${ACCOUNTS.map(a => a.name).join(', ')}. The brief says which account and which ad platform (Google Ads or Microsoft Ads) the view shows. The reader is the client: smart, not a PPC specialist. They already see every KPI, delta and chart on the page, so repeating "revenue -34%" adds nothing. Your value is what the page does not show: why it happened, where exactly it sits, since when, and whether it is normal.

Method (constraint thinking, find the binding constraint):
1. Start from the computed signals you are given. Pick the one or two movements that matter most in money.
2. Decompose: revenue = clicks x CVR x order value; ROAS = order value x CVR / CPC. Is it volume, cost, conversion or basket?
3. Timing: weekly or daily data shows whether it is a break on a date or a slow slide.
4. Season: compare with the same period last year, and last year's own movement between the same two periods.
5. Location: network, campaign, device, country, product. Name the part that carries most of the change.
6. Cause: always check account_context (audit findings, standing notes, the account manager's notes) for the period. An audit finding that explains the movement is stronger evidence than a pattern you infer; cite it with its source and date ("according to the PMax audit of 21 October"). Use communication to see what was agreed or done around the change. Then feed status, Quality Score, auction competitors, account changes when relevant.
   Audit findings never become advice in your text: use what they found, not what they recommend. Never name people.
Stop as soon as the story is clear. Usually 4 to 8 tool calls are enough; never fetch data you will not use.

Output (English, for the client):
- headline: one or two sentences, at most 220 characters: the story of this period in plain words.
- points: 3 or 4, each one sentence of at most 200 characters with the evidence, numbers included.
  type "fact" for what the data shows; type "interpretation" for a pattern you read in it, phrased as "points to" or "seems", never as certainty.
  link_page: the dashboard page where the reader can see it, or "none".
  sources: the references of the tool results the point rests on, as they appear in front of them: "T3" for a data table, "T5.2" for one finding, note or meeting line. One to three, the most direct first; [] only for a point that rests on the computed signals alone.

Rules:
- Copy every number exactly as it appears in the signals or tool results (format, decimals, currency). Never compute, round or estimate new numbers yourself. A number that does not appear literally in the data gets the point removed.
- Revenue, ROAS, CVR and conversions are only complete up to the matured date you are given; tool results flag later days. Never read those incomplete days as a decline.
- No advice, no next steps, no "we should". No profit, margin, POAS or break-even.
- Write all output in English, and write dates the English way (17 August, week of 7 September), never as YYYY-MM-DD.
- No em dashes or en dashes. Metric abbreviations stay English (ROAS, CPC, CVR, CTR, IS).
- Missing data is not evidence. Tools state from which date their data exists; never claim that something did not happen (no changes, no competitors, no rejections) for days before that date.
- If nothing notable happened, say so in the headline and give at most two points.
- the account manager's corrections of earlier analyses, when given, show how he wants this written: follow the lessons in his notes and versions. Never copy numbers from them; they belong to other periods.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['fact', 'interpretation'] },
          link_page: { type: 'string', enum: [...linkPages, 'none'] },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'type', 'link_page', 'sources'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'points'],
  additionalProperties: false,
} as const;

export interface AgentInput {
  ctx: ToolContext;
  facts: SignalFact[];
  brief: string;                 // the view: account, period, compare period, matured date, filters
  onStep?: (label: string) => void;
}

// All numbers the model may use: the brief, the signals and every tool result.
export const corpusFact = (corpus: string): SignalFact => ({ id: 'corpus', severity: 'notable', level: 'account', kind: 'shift', subject: '', metric: corpus, from: null, to: '', delta: null, impact: 0 });

export function fallbackStory(facts: SignalFact[]): Story {
  if (facts.length === 0) return { headline: 'No notable shifts in this period.', points: [] };
  const [first, ...rest] = facts.map(fallbackSignal);
  return { headline: `${first.title}. ${first.detail}`.trim(), points: rest.map(s => ({ text: `${s.title}. ${s.detail}`.trim(), type: 'fact' as const })) };
}

export async function runAgent({ ctx, facts, brief, onStep, fast = false, corrections = '' }: AgentInput & { fast?: boolean; corrections?: string }): Promise<AgentResult> {
  const signals = facts.map(({ id, severity, level, subject, metric, from, to, delta, context }) => ({ id, severity, level, subject, metric, from, to, delta, context }));
  const { parsed, corpus, calls, costUsd } = await runToolLoop<{ headline: string; points: { text: string; type: 'fact' | 'interpretation'; link_page: LinkPage; sources: string[] }[] }>({
    model: AGENT_MODEL, effort: 'high', fast, cite: true, system: SYSTEM, schema: SCHEMA, ctx, maxTurns: MAX_TURNS, onStep,
    messages: [{ role: 'user', content: `${brief}\n\nComputed signals (starting point):\n${JSON.stringify(signals, null, 1)}${corrections ? `\n\nthe account manager's corrections of earlier analyses of this account:\n${corrections}` : ''}` }],
  });
  const fallback: AgentResult = { story: fallbackStory(facts), source: 'fallback', costUsd };
  if (!parsed) return fallback;
  const allowed = corpusFact(`${brief}\n${JSON.stringify(signals)}\n${corpus}`);
  if (!usesOnlyFactNumbers(parsed.headline, allowed)) return fallback;
  const points = parsed.points
    .filter(p => usesOnlyFactNumbers(p.text, allowed))
    .slice(0, 4)
    .map(p => {
      const sources = resolveSources(p.sources ?? [], calls);
      return { text: p.text, type: p.type, ...(p.link_page !== 'none' && LINK_PAGES[p.link_page] ? { link: { path: LINK_PAGES[p.link_page] } } : {}), ...(sources.length ? { sources } : {}) };
    });
  return { story: { headline: parsed.headline, points }, source: 'ai', costUsd };
}

// The view in words, so the model knows exactly what the reader is looking at.
export function buildBrief(v: { accountLabel: string; range: { start: string; end: string }; compareRange: { start: string; end: string } | null; maturedEnd: string; today: string; filters: string[] }) {
  return [
    `Account: ${v.accountLabel}. Today: ${v.today}.`,
    `Selected period: ${v.range.start} to ${v.range.end}.`,
    v.compareRange ? `Comparison period: ${v.compareRange.start} to ${v.compareRange.end}.` : 'No comparison period.',
    `Revenue has matured up to and including ${v.maturedEnd}.`,
    v.filters.length ? `Filters in the view (they also apply to all tools): ${v.filters.join(', ')}.` : 'No filters: the whole account.',
  ].join('\n');
}
