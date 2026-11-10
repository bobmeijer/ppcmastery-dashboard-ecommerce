// Client-safe helpers that turn the campaign report into page-ready shapes.
import { addRow, derive, Derived, emptyTotals, FactRow, groupBy, sumRows, lagCutoff, Totals } from './metrics';
import type { RoleRow, TargetRow } from './reports';

export interface PeriodPoint extends Derived { period: string }

export function byPeriod(rows: FactRow[]): PeriodPoint[] {
  const groups = groupBy(rows, r => r.period);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, d]) => ({ period, ...d }));
}

// Aligns a compare series onto the current series by index so both can share
// one x-axis (the compare period has the same length by construction).
export function alignCompare(current: PeriodPoint[], compare: PeriodPoint[], metric: keyof Derived): Record<string, unknown>[] {
  return current.map((point, index) => ({
    period: point.period,
    current: point[metric],
    compare: compare[index] ? compare[index][metric] : null,
  }));
}

export function samplesTotal(roles: RoleRow[]): { count: number; value: number } {
  const rows = roles.filter(r => r.role === 'samples');
  return {
    count: rows.reduce((acc, r) => acc + Number(r.conversions || 0), 0),
    value: rows.reduce((acc, r) => acc + Number(r.conversions_value || 0), 0),
  };
}

export function activeTarget(targets: TargetRow[], accountId: string, metric: string, asOf: string): TargetRow | null {
  const candidates = targets.filter(t => t.account_id === accountId && t.metric === metric && t.valid_from <= asOf && (!t.valid_to || t.valid_to >= asOf));
  if (candidates.length === 0) return null;
  // Prefer floors and maxima (hard constraints) over soft targets when both apply.
  const order = { floor: 0, max: 0, target: 1, phase: 2 } as Record<string, number>;
  return [...candidates].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || b.valid_from.localeCompare(a.valid_from))[0];
}

export const targetLabel = (target: TargetRow) => {
  switch (target.kind) {
    case 'floor': return 'minimum';
    case 'max': return 'maximum';
    default: return 'target';
  }
};

// First period that falls inside the lag window, for chart shading.
export function lagStart(periods: string[], lagDays: number, grain: 'day' | 'week' | 'month'): string | null {
  const cutoff = lagCutoff(lagDays);
  const inside = periods.filter(p => {
    if (grain === 'day') return p > cutoff;
    // A week or month bucket is "inside" when its last day passes the cutoff.
    const end = new Date(`${p}T00:00:00Z`);
    if (grain === 'week') end.setUTCDate(end.getUTCDate() + 6); else end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return end.toISOString().slice(0, 10) > cutoff;
  });
  return inside.length ? inside[0] : null;
}

export const totals = (rows: FactRow[]) => sumRows(rows);

// Expectation band: mean +/- k standard deviations of the raw values in the
// trailing window. A value outside its own band is an
// anomaly worth a look. Null until the window is full; floor at zero.
export function rollingBand(values: (number | null)[], window: number, k = 1.5): { low: number | null; high: number | null; anomaly: boolean }[] {
  return values.map((v, i) => {
    if (window <= 1 || i < window - 1) return { low: null, high: null, anomaly: false };
    const slice = values.slice(i - window + 1, i + 1).filter((x): x is number => x !== null && Number.isFinite(x));
    if (slice.length < Math.max(3, Math.floor(window / 2))) return { low: null, high: null, anomaly: false };
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
    const low = Math.max(0, mean - k * sd);
    const high = mean + k * sd;
    return { low, high, anomaly: v !== null && (v < low || v > high) };
  });
}

// Rolling average over the trailing `window` periods (for
// Trends): additive metrics become the average per period, ratios are derived
// from the averaged totals (never an average of ratios). Periods without a full
// window get null so the line starts where it is honest.
export function rollingPeriods(points: PeriodPoint[], window: number): { period: string; value: Derived | null }[] {
  return points.map((p, i) => {
    if (window <= 1) return { period: p.period, value: p };
    if (i < window - 1) return { period: p.period, value: null };
    const acc = emptyTotals();
    for (let j = i - window + 1; j <= i; j += 1) addRow(acc, points[j]);
    for (const key of Object.keys(acc) as (keyof Totals)[]) acc[key] = acc[key] / window;
    return { period: p.period, value: derive(acc) };
  });
}
