// Overview signals for the AI analysis panel. Code decides what counts and computes every number; the model only
// words the result. Pure, tested in insightSignals.test.ts.
//
// Windows: revenue metrics (revenue, ROAS, conversions, CVR) only on matured days
// (outside lag_days), cost metrics up to yesterday. The compare side takes the same
// number of days from the start of the compare range.
import { addDays, change, daysBetween, fmtCount, fmtCurrency, fmtNumber, fmtRatio, groupBy, sumRows, type DateRange, type Derived, type FactRow } from './metrics';
import { displayNetwork as displayNetworkOf } from './filters';
import { goalForDays } from './goalsShaping';
import type { AccountGoals } from './goals';

export type Severity = 'alarm' | 'notable' | 'positive';
export type Level = 'account' | 'network' | 'campaign';
type MetricKey = 'cost' | 'conversions_value' | 'roas' | 'conversions' | 'cpc' | 'cvr';

// Starting values; move to the insight_thresholds table with the DB step.
export const THRESHOLDS = {
  account: { shift: 0.10, share: 0 },
  network: { shift: 0.15, share: 0.05 },
  campaign: { shift: 0.20, share: 0.02 },
  mixPoints: 0.05,         // network share of cost or revenue, in fraction points
  budgetLostIs: 0.10,      // Search campaign budget-lost IS that counts as alarm when ROAS is above the goal
  minDaysForNotable: 14,   // shorter periods: alarm signals only
  maxSignals: 5,
  maxAccountShifts: 2,     // leave room for the networks and campaigns that explain the move
};

export interface SignalFact {
  id: string;
  severity: Severity;
  level: Level;
  kind: 'shift' | 'mix' | 'goal' | 'budget';
  subject: string;              // 'Account', a network or a campaign name
  metric: string;               // display label
  from: string | null;          // formatted
  to: string;                   // formatted
  delta: string | null;         // formatted, e.g. "-24%" or "+8 pp"
  context?: string;             // formatted extra fact, e.g. "explains 62% of the decline"
  impact: number;               // euros, for ordering
  link?: { path: string; params?: Record<string, string> };
}

export interface SignalInput {
  rows: FactRow[];              // current period, day grain, filters applied
  compareRows: FactRow[];       // compare period, day grain, filters applied
  range: DateRange;
  compareRange: DateRange | null;
  lagDays: number;
  today: string;                // ISO, Europe/Amsterdam
  goals: AccountGoals | null;   // only for a single account
}

const LABEL: Record<MetricKey, string> = { cost: 'Cost', conversions_value: 'Revenue', roas: 'ROAS', conversions: 'Conversions', cpc: 'CPC', cvr: 'CVR' };
const REVENUE_METRICS: MetricKey[] = ['conversions_value', 'roas', 'conversions', 'cvr'];
// Up is good for these; for cost and CPC a rise is notable, never positive.
const UP_IS_GOOD: Record<MetricKey, boolean | null> = { conversions_value: true, roas: true, conversions: true, cvr: true, cost: null, cpc: false };

const fmt = (key: MetricKey, v: number | null) =>
  key === 'cost' || key === 'conversions_value' ? fmtCurrency(v) : key === 'cpc' ? fmtCurrency(v, 2) : key === 'roas' ? fmtRatio(v) : key === 'cvr' ? (v === null ? '-' : `${fmtNumber(v * 100, 2)}%`) : fmtCount(v);
const pct = (d: number) => `${d > 0 ? '+' : ''}${fmtNumber(d * 100, 0)}%`;
const points = (d: number) => `${d > 0 ? '+' : ''}${fmtNumber(d * 100, 0)} pp`;

function severityOf(key: MetricKey, delta: number, threshold: number): Severity {
  const good = UP_IS_GOOD[key];
  if (good === null) return 'notable';
  const favourable = good ? delta > 0 : delta < 0;
  if (favourable) return 'positive';
  return Math.abs(delta) >= threshold * 2 ? 'alarm' : 'notable';
}

interface Windows { revenue: { cur: FactRow[]; cmp: FactRow[]; end: string } | null; cost: { cur: FactRow[]; cmp: FactRow[]; end: string } | null }

// Slice both sides to the same number of days so a partial window compares fairly.
function slice(input: SignalInput, end: string): { cur: FactRow[]; cmp: FactRow[]; end: string } | null {
  const last = end < input.range.end ? end : input.range.end;
  if (last < input.range.start) return null;
  const days = daysBetween(input.range.start, last);
  const cmpEnd = input.compareRange ? addDays(input.compareRange.start, days - 1) : null;
  return {
    cur: input.rows.filter(r => r.period >= input.range.start && r.period <= last),
    cmp: input.compareRange && cmpEnd ? input.compareRows.filter(r => r.period >= input.compareRange!.start && r.period <= cmpEnd) : [],
    end: last,
  };
}

export function windowsFor(input: SignalInput): Windows {
  return {
    revenue: slice(input, addDays(input.today, -input.lagDays - 1)),
    cost: slice(input, addDays(input.today, -1)),
  };
}

const windowFor = (w: Windows, key: MetricKey) => (REVENUE_METRICS.includes(key) ? w.revenue : w.cost);

function shiftFacts(level: Level, groups: { name: string; cur: Derived; cmp: Derived | null }[], totals: { cur: Derived; cmp: Derived }, key: MetricKey, link: (name: string) => SignalFact['link']): SignalFact[] {
  const t = THRESHOLDS[level];
  const out: SignalFact[] = [];
  const shareBase = key === 'conversions_value' ? 'conversions_value' : 'cost';
  for (const g of groups) {
    if (!g.cmp) continue;
    const delta = change(g.cur[key] as number | null, g.cmp[key] as number | null);
    if (delta === null || Math.abs(delta) < t.shift) continue;
    const share = Math.max(g.cur[shareBase] / (totals.cur[shareBase] || 1), g.cmp[shareBase] / (totals.cmp[shareBase] || 1));
    if (level !== 'account' && share < t.share) continue;
    const euroDelta = key === 'cost' || key === 'conversions_value' ? Number(g.cur[key]) - Number(g.cmp[key]) : (g.cur.conversions_value - g.cmp.conversions_value);
    const accountDelta = totals.cur[shareBase] - totals.cmp[shareBase];
    const explains = level !== 'account' && (key === 'cost' || key === 'conversions_value') && Math.abs(accountDelta) > 0 && Math.sign(euroDelta) === Math.sign(accountDelta)
      ? Math.abs(euroDelta / accountDelta) : null;
    out.push({
      id: `${level}:${g.name}:${key}`,
      severity: severityOf(key, delta, t.shift),
      level, kind: 'shift', subject: g.name, metric: LABEL[key],
      from: fmt(key, g.cmp[key] as number | null), to: fmt(key, g.cur[key] as number | null), delta: pct(delta),
      context: explains !== null && explains >= 0.25 ? `explains ${fmtNumber(Math.min(explains, 1) * 100, 0)}% of the ${accountDelta > 0 ? 'rise' : 'decline'} in the total` : undefined,
      impact: Math.abs(euroDelta),
      link: link(g.name),
    });
  }
  return out;
}

function mixFacts(w: Windows): SignalFact[] {
  const out: SignalFact[] = [];
  for (const key of ['cost', 'conversions_value'] as const) {
    const win = windowFor(w, key);
    if (!win || win.cmp.length === 0) continue;
    const cur = groupBy(win.cur, displayNetworkOf);
    const cmp = groupBy(win.cmp, displayNetworkOf);
    const curTotal = sumRows(win.cur)[key];
    const cmpTotal = sumRows(win.cmp)[key];
    if (curTotal <= 0 || cmpTotal <= 0) continue;
    for (const name of new Set([...cur.keys(), ...cmp.keys()])) {
      const a = (cur.get(name)?.[key] ?? 0) / curTotal;
      const b = (cmp.get(name)?.[key] ?? 0) / cmpTotal;
      if (Math.max(a, b) < THRESHOLDS.network.share || Math.abs(a - b) < THRESHOLDS.mixPoints) continue;
      out.push({
        id: `mix:${name}:${key}`, severity: 'notable', level: 'network', kind: 'mix', subject: name,
        metric: `Share of ${key === 'cost' ? 'cost' : 'revenue'}`,
        from: `${fmtNumber(b * 100, 0)}%`, to: `${fmtNumber(a * 100, 0)}%`, delta: points(a - b),
        impact: Math.abs(a - b) * curTotal, link: { path: '/trends' },
      });
    }
  }
  return out;
}

// Closed period: matured revenue (or purchases) against the pro-rated goal. Running
// month: the same pace read as a month projection. ROAS under the floor and CPA above
// the ceiling are alarms. Each goal only when the account has it (goals.ts).
function goalFacts(input: SignalInput, w: Windows): SignalFact[] {
  const goals = input.goals;
  if (!goals || !w.revenue) return [];
  const total = sumRows(w.revenue.cur);
  const days = daysBetween(input.range.start, w.revenue.end);
  const running = input.range.end >= `${input.today.slice(0, 8)}01`;
  const out: SignalFact[] = [];
  const pace = (id: string, label: string, perMonth: number, actual: number, fmt: (v: number) => string) => {
    const goal = goalForDays(perMonth, input.range.start, days);
    if (goal <= 0) return;
    const ratio = actual / goal;
    out.push({
      id, severity: ratio >= 1 ? 'positive' : ratio >= 0.9 ? 'notable' : 'alarm', level: 'account', kind: 'goal', subject: 'Account',
      // A running period's matured days can fall in another month than its end: no month name.
      metric: running ? `${label} pace` : label, from: null, to: fmt(actual), delta: `${fmtNumber(ratio * 100, 0)}% of goal`,
      context: running ? `matured days to ${w.revenue!.end}; projected over a month ${fmt(ratio * perMonth)} against a goal of ${fmt(perMonth)}` : `goal ${fmt(goal)} pro rata over ${days} days`,
      impact: Math.abs(goal - actual) * (id === 'goal:revenue' ? 1 : 100) + 1e9,   // goal pace leads its severity group
    });
  };
  if (goals.revenuePerMonth) pace('goal:revenue', 'Revenue', goals.revenuePerMonth, total.conversions_value, v => fmtCurrency(v));
  if (goals.purchasesPerMonth) pace('goal:purchases', 'Purchases', goals.purchasesPerMonth, total.conversions, v => fmtCount(v));
  if (goals.roas !== null && total.roas !== null && total.roas < goals.roas) {
    out.push({
      id: 'goal:roas', severity: 'alarm', level: 'account', kind: 'goal', subject: 'Account', metric: 'ROAS below goal',
      from: null, to: fmtRatio(total.roas), delta: null, context: `goal ${fmtRatio(goals.roas)}`, impact: 1e9,
    });
  }
  const cpa = total.conversions > 0 ? total.cost / total.conversions : null;
  if (goals.cpa !== null && cpa !== null && cpa > goals.cpa) {
    out.push({
      id: 'goal:cpa', severity: 'alarm', level: 'account', kind: 'goal', subject: 'Account', metric: 'CPA above goal',
      from: null, to: fmtCurrency(cpa, 2), delta: null, context: `goal ${fmtCurrency(goals.cpa, 2)}`, impact: 1e9,
    });
  }
  return out;
}

// Search campaigns that lose more than 10% of impressions on budget while their ROAS is above the goal.
function budgetFacts(input: SignalInput, w: Windows): SignalFact[] {
  const floor = input.goals?.roas ?? null;
  if (floor === null || !w.cost || !w.revenue) return [];
  const search = (r: FactRow) => r.network === 'Search';
  const is = groupBy(w.cost.cur.filter(search), r => r.campaign_name);
  const roas = groupBy(w.revenue.cur.filter(search), r => r.campaign_name);
  const out: SignalFact[] = [];
  for (const [name, d] of is) {
    const r = roas.get(name)?.roas ?? null;
    if (d.budget_lost_is === null || d.budget_lost_is < THRESHOLDS.budgetLostIs || r === null || r < floor) continue;
    out.push({
      id: `budget:${name}`, severity: 'alarm', level: 'campaign', kind: 'budget', subject: name, metric: 'Impressions lost to budget',
      from: null, to: `${fmtNumber(d.budget_lost_is * 100, 0)}%`, delta: null, context: `ROAS ${fmtRatio(r)}, above goal`,
      impact: d.cost * d.budget_lost_is, link: { path: '/campaigns' },
    });
  }
  return out;
}

const ORDER: Record<Severity, number> = { alarm: 0, notable: 1, positive: 2 };

export function overviewSignals(input: SignalInput): SignalFact[] {
  const w = windowsFor(input);
  const facts: SignalFact[] = [...goalFacts(input, w), ...budgetFacts(input, w)];
  for (const key of ['conversions_value', 'cost', 'roas', 'conversions', 'cpc', 'cvr'] as MetricKey[]) {
    const win = windowFor(w, key);
    if (!win || win.cmp.length === 0) continue;
    const totals = { cur: sumRows(win.cur), cmp: sumRows(win.cmp) };
    facts.push(...shiftFacts('account', [{ name: 'Account', ...totals }], totals, key, () => ({ path: '/trends' })));
    if (key === 'conversions_value' || key === 'cost' || key === 'roas') {
      const cur = groupBy(win.cur, displayNetworkOf);
      const cmp = groupBy(win.cmp, displayNetworkOf);
      facts.push(...shiftFacts('network', [...cur].map(([name, d]) => ({ name, cur: d, cmp: cmp.get(name) ?? null })), totals, key,
        name => ({ path: '/campaigns', params: { networks: name } })));
    }
    if (key === 'conversions_value' || key === 'cost') {
      const cur = groupBy(win.cur, r => r.campaign_name);
      const cmp = groupBy(win.cmp, r => r.campaign_name);
      facts.push(...shiftFacts('campaign', [...cur].map(([name, d]) => ({ name, cur: d, cmp: cmp.get(name) ?? null })), totals, key, () => ({ path: '/campaigns' })));
    }
  }
  facts.push(...mixFacts(w));
  const short = daysBetween(input.range.start, input.range.end) < THRESHOLDS.minDaysForNotable;
  // A campaign that is the whole of its network's move tells the same story twice: keep the network.
  const networkMoves = new Set(facts.filter(f => f.level === 'network' && f.kind === 'shift').map(f => `${f.metric}:${Math.round(f.impact)}`));
  return facts
    .filter(f => !(f.level === 'campaign' && f.kind === 'shift' && networkMoves.has(`${f.metric}:${Math.round(f.impact)}`)))
    .filter(f => !short || f.severity === 'alarm')
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.impact - a.impact)
    .filter((f, _, all) => !(f.level === 'account' && f.kind === 'shift') || all.filter(g => g.level === 'account' && g.kind === 'shift').indexOf(f) < THRESHOLDS.maxAccountShifts)
    .slice(0, THRESHOLDS.maxSignals);
}
