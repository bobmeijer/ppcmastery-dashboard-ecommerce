// Pure shaping for the product panel on Products: one product's
// daily rows (date x campaign x country x label) become the trend series, the
// label per day, the label periods and the split per campaign and country.
// Tested in productDetail.test.ts.
import { addDays, daysBetween } from './metrics';
import { productLabel } from './bucketsShaping';
import { deriveProduct, emptyProductTotals, ProductDerived, ProductTotals } from './productsShaping';

export interface ProductDayRow {
  date: string;
  campaign_id: string;
  campaign_name: string;
  campaign_bucket: string;
  country_code: string | null;
  label: string | null;
  impressions: number | string;
  clicks: number | string;
  cost: number | string;
  conversions: number | string;
  conversions_value: number | string;
}

const add = (target: ProductTotals, row: Partial<Record<keyof ProductTotals, number | string>>) => {
  target.impressions += Number(row.impressions || 0);
  target.clicks += Number(row.clicks || 0);
  target.cost += Number(row.cost || 0);
  target.conversions += Number(row.conversions || 0);
  target.conversions_value += Number(row.conversions_value || 0);
  return target;
};

export interface DayPoint extends ProductDerived {
  date: string;
  label: string | null;   // label that day; null = no rows (no impressions), carried label in `carried`
  carried: string | null; // last known label, for drawing the strip through days without data
}

// Every day of the window, also the ones without rows. The day's label is the
// one with the most impressions (a day can carry two when the feed switched mid-day).
export function dailyPoints(rows: ProductDayRow[], start: string, end: string): DayPoint[] {
  const byDate = new Map<string, ProductDayRow[]>();
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    byDate.set(d, [...(byDate.get(d) || []), r]);
  }
  const points: DayPoint[] = [];
  let carried: string | null = null;
  const days = daysBetween(start, end);
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const dayRows = byDate.get(date) || [];
    const totals = dayRows.reduce((acc, r) => add(acc, r), emptyProductTotals());
    let label: string | null = null;
    if (dayRows.length) {
      const perLabel = new Map<string, number>();
      for (const r of dayRows) {
        const l = productLabel(r.label);
        perLabel.set(l, (perLabel.get(l) || 0) + Number(r.impressions || 0) + Number(r.cost || 0));
      }
      label = [...perLabel.entries()].sort((a, b) => b[1] - a[1])[0][0];
      carried = label;
    }
    points.push({ date, label, carried, ...deriveProduct(totals) });
  }
  return points;
}

export interface TrendPoint extends ProductDerived { period: string; partial?: boolean }

// Week buckets start on Monday; a week cut by the window edges is marked partial.
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
};

export function trendPoints(points: DayPoint[], grain: 'day' | 'week'): TrendPoint[] {
  if (grain === 'day') return points.map(p => ({ ...p, period: p.date }));
  const weeks = new Map<string, { totals: ProductTotals; days: number }>();
  for (const p of points) {
    const w = mondayOf(p.date);
    const entry = weeks.get(w) || { totals: emptyProductTotals(), days: 0 };
    add(entry.totals, p);
    entry.days += 1;
    weeks.set(w, entry);
  }
  return [...weeks.entries()].map(([period, w]) => ({ period, ...deriveProduct(w.totals), ...(w.days < 7 ? { partial: true } : {}) }));
}

export interface LabelPeriod extends ProductDerived {
  label: string;
  start: string;
  end: string;
  days: number;
  activeDays: number;       // days with impressions
  costPerDay: number;       // over active days
}

// Consecutive runs of the same label. Days without data join the run they sit in
// (the label did not change while the product was not shown).
export function labelPeriods(points: DayPoint[]): LabelPeriod[] {
  const periods: { label: string; start: string; end: string; points: DayPoint[] }[] = [];
  for (const p of points) {
    const label = p.label ?? p.carried;
    if (label === null) continue;
    const last = periods[periods.length - 1];
    if (last && last.label === label) {
      last.end = p.date;
      last.points.push(p);
    } else {
      periods.push({ label, start: p.date, end: p.date, points: [p] });
    }
  }
  return periods.map(r => {
    const totals = r.points.reduce((acc, p) => add(acc, p), emptyProductTotals());
    const activeDays = r.points.filter(p => p.label !== null).length;
    return {
      label: r.label, start: r.start, end: r.end, days: daysBetween(r.start, r.end), activeDays,
      costPerDay: activeDays > 0 ? Math.round((totals.cost / activeDays) * 100) / 100 : 0,
      ...deriveProduct(totals),
    };
  });
}

export interface SplitRow extends ProductDerived { name: string; bucket?: string; share: number | null }

export function splitBy(rows: ProductDayRow[], start: string, end: string, key: 'campaign' | 'country'): SplitRow[] {
  const groups = new Map<string, { totals: ProductTotals; bucket: string }>();
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    if (d < start || d > end) continue;
    const name = key === 'campaign' ? (r.campaign_name || r.campaign_id) : (r.country_code || 'Other');
    const g = groups.get(name) || { totals: emptyProductTotals(), bucket: r.campaign_bucket || '' };
    add(g.totals, r);
    groups.set(name, g);
  }
  const totalCost = [...groups.values()].reduce((a, g) => a + g.totals.cost, 0);
  return [...groups.entries()]
    .map(([name, g]) => ({ name, ...(key === 'campaign' ? { bucket: g.bucket } : {}), ...deriveProduct(g.totals), share: totalCost > 0 ? g.totals.cost / totalCost : null }))
    .sort((a, b) => b.cost - a.cost || b.impressions - a.impressions);
}

export function periodTotals(points: DayPoint[], start: string, end: string): ProductDerived {
  return deriveProduct(points.filter(p => p.date >= start && p.date <= end).reduce((acc, p) => add(acc, p), emptyProductTotals()));
}
