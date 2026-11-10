import { describe, expect, it } from 'vitest';
import { overviewSignals, windowsFor, type SignalInput } from './insightSignals';
import { foreignNumbers, fallbackSignal, usesOnlyFactNumbers } from './insightWriter';
import { addDays, type FactRow } from './metrics';

const row = (period: string, campaign: string, network: string, cost: number, value: number, extra: Partial<FactRow> = {}): FactRow => ({
  account_id: 'de', period, campaign_id: campaign, campaign_name: campaign, channel_type: '', status: 'ENABLED', network, category: 'Generic', bucket: '',
  target_roas: null, target_cpa: null, impressions: 1000, clicks: 100, cost, conversions: value / 100, conversions_value: value,
  all_conversions: 0, all_conversions_value: 0, eligible_impressions: 0, is_impressions: 0, budget_lost_impressions: 0, rank_lost_impressions: 0, ...extra,
});

const days = (start: string, n: number, make: (day: string) => FactRow[]) => Array.from({ length: n }, (_, i) => make(addDays(start, i))).flat();

const september = { start: '2026-09-01', end: '2026-09-30' };
const august = { start: '2026-08-01', end: '2026-08-30' };

const base = (overrides: Partial<SignalInput> = {}): SignalInput => ({
  rows: days('2026-09-01', 30, d => [row(d, 'PMax', 'PMax', 1000, 3000), row(d, 'Search', 'Search', 500, 2000)]),
  compareRows: days('2026-08-01', 30, d => [row(d, 'PMax', 'PMax', 1000, 3000), row(d, 'Search', 'Search', 500, 2000)]),
  range: september, compareRange: august, lagDays: 21, today: '2026-10-22', goals: null, ...overrides,
});

describe('windowsFor', () => {
  it('cuts revenue at the lag and cost at yesterday, compare side the same length', () => {
    const w = windowsFor(base({ range: { start: '2026-10-01', end: '2026-10-21' }, compareRange: { start: '2026-09-10', end: '2026-09-30' }, rows: [], compareRows: [] }));
    expect(w.revenue).toBeNull();                 // every October day is still inside the 21-day lag
    expect(w.cost?.end).toBe('2026-10-21');
  });
});

describe('overviewSignals', () => {
  it('stays quiet when nothing moves', () => {
    expect(overviewSignals(base())).toEqual([]);
  });

  it('names the network that explains the drop, alarm first', () => {
    const rows = days('2026-09-01', 30, d => [row(d, 'PMax', 'PMax', 1000, 1200), row(d, 'Search', 'Search', 500, 2000)]);
    const signals = overviewSignals(base({ rows }));
    expect(signals[0].severity).toBe('alarm');
    // PMax counts as Non-Branded Shopping here (filters.ts, displayNetwork).
    const pmax = signals.find(s => s.id === 'network:Non-Branded Shopping:conversions_value');
    expect(pmax?.delta).toBe('-60%');
    expect(pmax?.context).toBe('explains 100% of the decline in the total');
  });

  it('ignores small campaigns under the share minimum', () => {
    const rows = days('2026-09-01', 30, d => [row(d, 'PMax', 'PMax', 1000, 3000), row(d, 'Search', 'Search', 500, 2000), row(d, 'Tiny', 'Search', 5, 5)]);
    const compareRows = days('2026-08-01', 30, d => [row(d, 'PMax', 'PMax', 1000, 3000), row(d, 'Search', 'Search', 500, 2000), row(d, 'Tiny', 'Search', 5, 50)]);
    expect(overviewSignals(base({ rows, compareRows })).find(s => s.subject === 'Tiny')).toBeUndefined();
  });

  it('reads goal pace for a closed month against the pro-rated goal', () => {
    const [goal] = overviewSignals(base({ goals: { revenuePerMonth: 200000, purchasesPerMonth: null, roas: 1.54, cpa: null } }));
    expect(goal.id).toBe('goal:revenue');
    expect(goal.delta).toBe('75% of goal');  // 150,000 of 200,000
    expect(goal.severity).toBe('alarm');
  });

  it('reads a purchases goal and a CPA ceiling when the account has them (Shop B)', () => {
    // 30 days x (30 + 20) conversions = 1.500, cost 45.000: CPA 30
    const facts = overviewSignals(base({ goals: { revenuePerMonth: null, purchasesPerMonth: 2000, roas: null, cpa: 25 } }));
    expect(facts.find(f => f.id === 'goal:purchases')?.delta).toBe('75% of goal');
    expect(facts.find(f => f.id === 'goal:cpa')?.severity).toBe('alarm');
    expect(facts.some(f => f.id === 'goal:revenue' || f.id === 'goal:roas')).toBe(false);
  });

  it('keeps notable signals out of periods under 14 days', () => {
    const range = { start: '2026-09-01', end: '2026-09-07' };
    const rows = days('2026-09-01', 7, d => [row(d, 'PMax', 'PMax', 1150, 3000), row(d, 'Search', 'Search', 500, 2000)]);
    expect(overviewSignals(base({ range, compareRange: { start: '2026-08-25', end: '2026-08-31' }, rows }))).toEqual([]);
  });

  it('flags budget-lost IS on a Search campaign above the ROAS goal', () => {
    const lost = { eligible_impressions: 1000, is_impressions: 700, budget_lost_impressions: 200 };
    const rows = days('2026-09-01', 30, d => [row(d, 'PMax', 'PMax', 1000, 3000), row(d, 'Search', 'Search', 500, 2000, lost)]);
    const budget = overviewSignals(base({ rows, goals: { revenuePerMonth: 150000, purchasesPerMonth: null, roas: 1.54, cpa: null } })).find(s => s.kind === 'budget');
    expect(budget).toMatchObject({ severity: 'alarm', subject: 'Search', to: '20%' });
  });
});

describe('writer guards', () => {
  const fact = { id: 'x', severity: 'alarm' as const, level: 'network' as const, kind: 'shift' as const, subject: 'Performance Max', metric: 'Revenue', from: '€155,927', to: '€68,001', delta: '-56%', context: 'explains 81% of the decline in the total', impact: 1 };
  it('accepts text that only uses the fact numbers', () => {
    expect(usesOnlyFactNumbers('Revenue for Performance Max fell 56%, from €155,927 to €68,001.', fact)).toBe(true);
    expect(usesOnlyFactNumbers('Revenue fell from € 155,927, down 56%, to € 68,001, a clear drop.', fact)).toBe(true);
  });
  it('rejects a number the fact does not contain', () => {
    expect(usesOnlyFactNumbers('Revenue for Performance Max fell 57%', fact)).toBe(false);
  });
  it('reads en-GB decimals and keeps other formats out', () => {
    const decimals = { ...fact, from: '1,234.56', to: '3.5%', delta: null, context: undefined };
    expect(foreignNumbers('From 1,234.56 to 3.5%.', decimals)).toEqual([]);
    expect(foreignNumbers('From 1.234,56 to 3,5%.', decimals)).toEqual(['1.234,56', '3,5']);
    expect(foreignNumbers('From 1,234.57 to 3.5%.', decimals)).toEqual(['1,234.57']);
  });
  it('allows an English date from an ISO date in the data', () => {
    const dated = { ...fact, from: null, to: '2026-09-07', delta: null, context: undefined };
    expect(foreignNumbers('The week of 7 September 2026.', dated)).toEqual([]);
  });
  it('words the fallback from the fact alone', () => {
    expect(fallbackSignal(fact)).toEqual({ id: 'x', title: 'Performance Max: Revenue -56%', detail: '€155,927 to €68,001. Explains 81% of the decline in the total.' });
  });
});
