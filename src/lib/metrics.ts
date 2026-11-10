import { CURRENCY, LOCALE, TIME_ZONE } from '@/lib/config';
// Pure aggregation and derived metrics. Runs on both server and client.
// No profit, margin or POAS anywhere.

export interface FactRow {
  account_id: string;
  period: string;
  campaign_id: string;
  campaign_name: string;
  channel_type: string;
  status: string;
  network: string;
  category: string;
  bucket: string;
  target_roas: number | null;
  target_cpa: number | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  all_conversions: number;
  all_conversions_value: number;
  eligible_impressions: number;
  is_impressions: number;
  budget_lost_impressions: number;
  rank_lost_impressions: number;
}

export interface Totals {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  all_conversions: number;
  all_conversions_value: number;
  eligible_impressions: number;
  is_impressions: number;
  budget_lost_impressions: number;
  rank_lost_impressions: number;
}

export interface Derived extends Totals {
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  cvr: number | null;
  roas: number | null;
  aov: number | null;
  impression_share: number | null;
  budget_lost_is: number | null;
  rank_lost_is: number | null;
}

export const emptyTotals = (): Totals => ({
  impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, all_conversions: 0,
  all_conversions_value: 0, eligible_impressions: 0, is_impressions: 0, budget_lost_impressions: 0, rank_lost_impressions: 0,
});

const TOTAL_KEYS = Object.keys(emptyTotals()) as (keyof Totals)[];

export function addRow(target: Totals, row: Partial<Totals>): Totals {
  for (const key of TOTAL_KEYS) target[key] += Number(row[key] || 0);
  return target;
}

export const safeDiv = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function derive(totals: Totals): Derived {
  return {
    ...totals,
    ctr: safeDiv(totals.clicks, totals.impressions),
    cpc: safeDiv(totals.cost, totals.clicks),
    cpa: safeDiv(totals.cost, totals.conversions),
    cvr: safeDiv(totals.conversions, totals.clicks),
    roas: safeDiv(totals.conversions_value, totals.cost),
    aov: safeDiv(totals.conversions_value, totals.conversions),
    impression_share: safeDiv(totals.is_impressions, totals.eligible_impressions),
    budget_lost_is: safeDiv(totals.budget_lost_impressions, totals.eligible_impressions),
    rank_lost_is: safeDiv(totals.rank_lost_impressions, totals.eligible_impressions),
  };
}

export function sumRows(rows: Partial<Totals>[]): Derived {
  return derive(rows.reduce<Totals>((acc, row) => addRow(acc, row), emptyTotals()));
}

export function groupBy<T extends Partial<Totals>>(rows: T[], key: (row: T) => string): Map<string, Derived> {
  const groups = new Map<string, Totals>();
  for (const row of rows) {
    const k = key(row);
    groups.set(k, addRow(groups.get(k) || emptyTotals(), row));
  }
  return new Map([...groups.entries()].map(([k, totals]) => [k, derive(totals)]));
}

export type MetricKey = keyof Derived;

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  format: 'currency' | 'number' | 'percent' | 'ratio' | 'decimal';
  higherIsBetter: boolean;
  lagging: boolean;      // depends on conversions (undercounted inside the lag window)
  clientVisible: boolean;
}

export const METRICS: MetricDefinition[] = [
  { key: 'cost', label: 'Cost', format: 'currency', higherIsBetter: false, lagging: false, clientVisible: true },
  { key: 'conversions_value', label: 'Revenue', format: 'currency', higherIsBetter: true, lagging: true, clientVisible: true },
  { key: 'roas', label: 'ROAS', format: 'ratio', higherIsBetter: true, lagging: true, clientVisible: true },
  { key: 'conversions', label: 'Purchases', format: 'decimal', higherIsBetter: true, lagging: true, clientVisible: true },
  { key: 'cpa', label: 'CPA', format: 'currency', higherIsBetter: false, lagging: true, clientVisible: true },
  { key: 'aov', label: 'AOV', format: 'currency', higherIsBetter: true, lagging: true, clientVisible: true },
  { key: 'cvr', label: 'CVR', format: 'percent', higherIsBetter: true, lagging: true, clientVisible: true },
  { key: 'clicks', label: 'Clicks', format: 'number', higherIsBetter: true, lagging: false, clientVisible: true },
  { key: 'impressions', label: 'Impressions', format: 'number', higherIsBetter: true, lagging: false, clientVisible: true },
  { key: 'ctr', label: 'CTR', format: 'percent', higherIsBetter: true, lagging: false, clientVisible: true },
  { key: 'cpc', label: 'CPC', format: 'currency', higherIsBetter: false, lagging: false, clientVisible: true },
  { key: 'impression_share', label: 'Impression share', format: 'percent', higherIsBetter: true, lagging: false, clientVisible: true },
  { key: 'budget_lost_is', label: 'Lost IS (budget)', format: 'percent', higherIsBetter: false, lagging: false, clientVisible: true },
  { key: 'rank_lost_is', label: 'Lost IS (rank)', format: 'percent', higherIsBetter: false, lagging: false, clientVisible: true },
];

export const metricDefinition = (key: MetricKey) => METRICS.find(m => m.key === key);

// Share of revenue within a set of rows (share of revenue,
// not cost), for the current period and for the comparison period, so the
// column sums to 100% on both sides and can be compared.
export function withRevenueShare<T extends { conversions_value: number; previous: { conversions_value: number } | null }>(rows: T[]): (T & { share: number | null; previousShare: number | null })[] {
  const total = rows.reduce((acc, r) => acc + r.conversions_value, 0);
  const previousTotal = rows.reduce((acc, r) => acc + (r.previous ? r.previous.conversions_value : 0), 0);
  return rows.map(r => ({
    ...r,
    share: total > 0 ? r.conversions_value / total : null,
    previousShare: previousTotal > 0 && r.previous ? r.previous.conversions_value / previousTotal : null,
  }));
}

export const change = (current: number | null, previous: number | null): number | null => {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
};

// --- formatting (en-GB) --------------------------------------------------------

export const fmtCurrency = (value: number | null, digits = 0) =>
  value === null ? '-' : new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
export const fmtNumber = (value: number | null, digits = 0) =>
  value === null ? '-' : new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
export const fmtPercent = (value: number | null, digits = 1) =>
  value === null ? '-' : new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
// ROAS reads as a percentage everywhere (207%, never 2,07x).
export const fmtRatio = (value: number | null) => (value === null ? '-' : `${fmtNumber(value * 100, 0)}%`);

// Absolute difference of a ratio or percentage metric reads as points ("+36 pt"), never as a percentage of itself.
export function formatMetricDelta(key: MetricKey, value: number): string {
  const def = metricDefinition(key);
  if (def && (def.format === 'ratio' || def.format === 'percent')) return `${fmtNumber(value * 100, def.format === 'ratio' ? 0 : 1)} pt`;
  return formatMetric(key, value);
}

// Conversions are fractional (data-driven attribution, Microsoft's qualified counts):
// small counts keep their decimals so a CPA next to them adds up.
export function fmtCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return fmtNumber(value);
  const abs = Math.abs(value);
  if (abs > 0 && abs < 1) return fmtNumber(value, 2);
  if (abs < 10 && Math.round(value * 10) % 10 !== 0) return fmtNumber(value, 1);
  return fmtNumber(value, 0);
}

export function formatMetric(key: MetricKey, value: number | null): string {
  const def = metricDefinition(key);
  if (!def) return fmtNumber(value);
  switch (def.format) {
    case 'currency': return fmtCurrency(value, key === 'cpc' ? 2 : 0);
    case 'percent': return fmtPercent(value);
    case 'ratio': return fmtRatio(value);
    case 'decimal': return fmtCount(value);
    default: return fmtNumber(value);
  }
}

// --- dates ---------------------------------------------------------------------

export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

// Today's date in Amsterdam as a UTC-midnight Date: the accounts report in
// Amsterdam time, so between 00:00 and 02:00 local the UTC date is a day behind.
export function accountToday(now = new Date()): Date {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${local}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

export interface DateRange { start: string; end: string }

// shift back by whole weeks so weekdays line up (30 days
// -> 35 back); the same length, never overlapping the range itself.
export function previousPeriod(range: DateRange): DateRange {
  const length = daysBetween(range.start, range.end);
  const shift = Math.ceil(length / 7) * 7;
  return { start: addDays(range.start, -shift), end: addDays(range.end, -shift) };
}

export function previousYear(range: DateRange): DateRange {
  return { start: addDays(range.start, -364), end: addDays(range.end, -364) };
}

// Default window: the last N complete days ending at today minus the lag.
export function lagAwareRange(lagDays: number, days = 30, today = accountToday()): DateRange {
  const end = addDays(isoDate(today), -lagDays);
  return { start: addDays(end, -(days - 1)), end };
}

export const lagCutoff = (lagDays: number, today = accountToday()) => addDays(isoDate(today), -lagDays);

export function chooseGrain(range: DateRange): 'day' | 'week' | 'month' {
  const days = daysBetween(range.start, range.end);
  if (days <= 92) return 'day';
  if (days <= 400) return 'week';
  return 'month';
}
