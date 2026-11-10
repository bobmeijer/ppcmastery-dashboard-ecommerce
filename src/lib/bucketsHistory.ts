// Pure shaping for the product part of the Buckets page: from one
// row per product per day (with that day's ProductHero label) to
// - the distribution per label, counted two ways: label at the time (the
//   day's label, like Google Ads and the bucket campaigns) and current label
//   (the label in the feed now, like ProductHero's donuts);
// - the bucket history per day or week;
// - the transitions from the first to the last label in the period;
// - the movers: products whose label changed, sorted by cost in the period.
// Runs on the server (src/app/api/report/buckets); tested in bucketsHistory.test.ts.
import { addDays, daysBetween } from './metrics';
import { productLabel } from './bucketsShaping';
import { deriveProduct, emptyProductTotals, FeedProductInfo, labelName, ProductDerived, ProductTotals } from './productsShaping';
import { effectiveTypeFilter, matchesType, TypeFilter, typeLevels, TypeOption, typeOptions } from './productTypes';

// [date, item_id, label, impressions, clicks, cost, conversions, conversions_value, product_type]
export type LabelDayTuple = [string, string, string | null, number | string, number | string, number | string, number | string, number | string, string | null];

export const LABELS = ['H', 'S', 'V', 'Z', ''] as const;
const ORDER = (label: string) => {
  const i = (LABELS as readonly string[]).indexOf(label);
  return i >= 0 ? i : LABELS.length - 1;
};
const sortLabels = (labels: Iterable<string>) => [...new Set(labels)].sort((a, b) => ORDER(a) - ORDER(b) || a.localeCompare(b));

interface Day extends ProductTotals { date: string; label: string }

interface ProductDays {
  id: string;
  key: string;
  type: string;
  days: Day[];   // one per active date, ordered; the day's label is the one with most weight
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const add = (t: ProductTotals, r: ProductTotals) => {
  t.impressions += r.impressions; t.clicks += r.clicks; t.cost += r.cost; t.conversions += r.conversions; t.conversions_value += r.conversions_value;
  return t;
};
const sum = (rows: ProductTotals[]) => rows.reduce((acc, r) => add(acc, r), emptyProductTotals());

function groupProducts(tuples: LabelDayTuple[], feed: Map<string, FeedProductInfo>): Map<string, ProductDays> {
  const products = new Map<string, ProductDays>();
  for (const t of tuples) {
    const [rawDate, id, rawLabel, imp, clicks, cost, conv, value, type] = t;
    const key = id.trim().toLowerCase();
    if (!key) continue;
    const p = products.get(key) || { id, key, type: feed.get(key)?.product_type || '', days: [] };
    if (!p.type && type) p.type = type;
    const date = String(rawDate).slice(0, 10);
    const label = productLabel(rawLabel);
    const metrics = { impressions: Number(imp || 0), clicks: Number(clicks || 0), cost: Number(cost || 0), conversions: Number(conv || 0), conversions_value: Number(value || 0) };
    const last = p.days[p.days.length - 1];
    if (last && last.date === date) {
      // Two labels on one day (feed switched mid-day): keep the heavier label, sum the metrics.
      const weight = (d: ProductTotals) => d.impressions + d.cost;
      if (weight(metrics) > weight(last)) last.label = label;
      add(last, metrics);
    } else {
      p.days.push({ date, label, ...metrics });
    }
    products.set(key, p);
  }
  for (const p of products.values()) p.days.sort((a, b) => a.date.localeCompare(b.date));
  return products;
}

export interface DistributionRow extends ProductDerived {
  label: string;
  name: string;
  products: number;
  cost_share: number | null;
  revenue_share: number | null;
}

function distribution(groups: Map<string, { products: Set<string>; totals: ProductTotals }>): DistributionRow[] {
  const all = sum([...groups.values()].map(g => g.totals));
  return sortLabels(groups.keys()).map(label => {
    const g = groups.get(label)!;
    return {
      label, name: labelName(label), products: g.products.size, ...deriveProduct(g.totals),
      cost_share: all.cost > 0 ? r4(g.totals.cost / all.cost) : null,
      revenue_share: all.conversions_value > 0 ? r4(g.totals.conversions_value / all.conversions_value) : null,
    };
  });
}

const bucketGroup = (map: Map<string, { products: Set<string>; totals: ProductTotals }>, label: string) => {
  const g = map.get(label) || { products: new Set<string>(), totals: emptyProductTotals() };
  map.set(label, g);
  return g;
};

// Label at the time: every day counts under that day's label; a product that switched counts in both.
export function momentDistribution(products: ProductDays[]): DistributionRow[] {
  const groups = new Map<string, { products: Set<string>; totals: ProductTotals }>();
  for (const p of products) for (const d of p.days) {
    const g = bucketGroup(groups, d.label);
    g.products.add(p.key);
    add(g.totals, d);
  }
  return distribution(groups);
}

// Current label: the whole period counts under the label in the feed now (last label in the period when the product left the feed).
export function currentDistribution(products: ProductDays[], currentLabel: (p: ProductDays) => string): DistributionRow[] {
  const groups = new Map<string, { products: Set<string>; totals: ProductTotals }>();
  for (const p of products) {
    const g = bucketGroup(groups, currentLabel(p));
    g.products.add(p.key);
    add(g.totals, sum(p.days));
  }
  return distribution(groups);
}

export interface HistoryPoint { period: string; partial?: boolean; [key: string]: number | string | boolean | undefined }

const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

// Per period and label: cost_<L>, value_<L>, products_<L> (distinct products shown with that label). '' is keyed as 'none'.
export function history(products: ProductDays[], start: string, end: string, grain: 'day' | 'week'): HistoryPoint[] {
  const buckets = new Map<string, Map<string, { totals: ProductTotals; products: Set<string> }>>();
  for (const p of products) for (const d of p.days) {
    if (d.date < start || d.date > end) continue;
    const period = grain === 'week' ? mondayOf(d.date) : d.date;
    const byLabel = buckets.get(period) || new Map();
    const g = byLabel.get(d.label) || { totals: emptyProductTotals(), products: new Set<string>() };
    add(g.totals, d);
    g.products.add(p.key);
    byLabel.set(d.label, g);
    buckets.set(period, byLabel);
  }
  const firstWeek = mondayOf(start);
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, byLabel]) => {
    const point: HistoryPoint = { period };
    if (grain === 'week') {
      const weekEnd = new Date(`${period}T00:00:00Z`); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      if ((period === firstWeek && period < start) || weekEnd.toISOString().slice(0, 10) > end) point.partial = true;
    }
    for (const [label, g] of byLabel) {
      const k = label || 'none';
      point[`cost_${k}`] = r2(g.totals.cost);
      point[`value_${k}`] = r2(g.totals.conversions_value);
      point[`products_${k}`] = g.products.size;
    }
    return point;
  });
}

// Label rank for the direction of a switch: H is the top, Z the bottom.
const RANK: Record<string, number> = { H: 0, S: 1, V: 2, Z: 3 };
export type Direction = 'up' | 'down' | 'flip';
export const directionOf = (from: string, to: string): Direction =>
  from === to ? 'flip' : (RANK[to] ?? 9) < (RANK[from] ?? 9) ? 'up' : 'down';

export interface TransitionCell { from: string; to: string; count: number; cost: number; moved: number }

// First and last label the product showed in the period; moved = products in
// the cell that switched at least once (on the diagonal: the flip-floppers).
export function transitions(products: ProductDays[]): { labels: string[]; cells: TransitionCell[] } {
  const list = products.filter(p => p.days.length).map(p => ({
    from: p.days[0].label,
    to: p.days[p.days.length - 1].label,
    cost: sum(p.days).cost,
    moved: p.days.some(d => d.label !== p.days[0].label),
  }));
  const labels = sortLabels(list.flatMap(t => [t.from, t.to]));
  const cells: TransitionCell[] = [];
  for (const from of labels) for (const to of labels) {
    const inCell = list.filter(t => t.from === from && t.to === to);
    if (inCell.length) cells.push({ from, to, count: inCell.length, cost: r2(inCell.reduce((a, t) => a + t.cost, 0)), moved: inCell.filter(t => t.moved).length });
  }
  return { labels, cells };
}

export interface MoverSide extends ProductDerived { activeDays: number; costPerDay: number }

export interface Mover {
  id: string;
  path: string[];          // labels in order, consecutive duplicates removed ("H", "V", "H")
  from: string;            // first label in the period (matrix row)
  to: string;              // last label in the period (matrix column)
  direction: Direction;    // of the last switch
  switchDate: string;      // first day of the last label run
  before: MoverSide;       // the label run right before the last switch
  after: MoverSide;        // the last label run
  strip: string;           // one char per day of the period: label letter on days with data, lowercase carried label without, '.' before the first day
  cost: number;            // whole period, the sort key
  conversions_value: number;
}

const side = (days: Day[]): MoverSide => {
  const t = sum(days);
  return { ...deriveProduct(t), activeDays: days.length, costPerDay: days.length ? r2(t.cost / days.length) : 0 };
};

// Consecutive runs of the same label.
const runsOf = (days: Day[]) => {
  const runs: Day[][] = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && last[0].label === d.label) last.push(d); else runs.push([d]);
  }
  return runs;
};

function stripOf(days: Day[], start: string, end: string): string {
  const byDate = new Map(days.map(d => [d.date, d.label]));
  let carried = '';
  let out = '';
  for (let i = 0, n = daysBetween(start, end); i < n; i += 1) {
    const date = addDays(start, i);
    const label = byDate.get(date);
    if (label) { carried = label; out += label; } else out += carried ? carried.toLowerCase() : '.';
  }
  return out;
}

export function movers(products: ProductDays[], start: string, end: string): Mover[] {
  const list: Mover[] = [];
  for (const p of products) {
    const runs = runsOf(p.days);
    if (runs.length < 2) continue;
    const last = runs[runs.length - 1];
    const prev = runs[runs.length - 2];
    const t = sum(p.days);
    list.push({
      id: p.id, path: runs.map(r => r[0].label), from: runs[0][0].label, to: last[0].label,
      direction: directionOf(prev[0].label, last[0].label), switchDate: last[0].date,
      before: side(prev), after: side(last), strip: stripOf(p.days, start, end),
      cost: r2(t.cost), conversions_value: r2(t.conversions_value),
    });
  }
  return list.sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));
}

export interface SwitchEffect {
  from: string;
  to: string;
  direction: Direction;
  products: number;
  before: MoverSide;        // summed over the products, complete days only
  after: MoverSide;
  costPerDayChange: number | null;
  roasChange: number | null;
}

// What the last switch did, per transition type, on complete days only (days
// up to the lag cutoff) on both sides, so a fresh demotion is not judged on
// conversions that have not come in yet. Products without complete days on
// both sides of the switch are left out.
export function switchEffects(products: ProductDays[], cutoff: string): SwitchEffect[] {
  const groups = new Map<string, { from: string; to: string; products: number; before: Day[]; after: Day[] }>();
  for (const p of products) {
    const runs = runsOf(p.days.filter(d => d.date <= cutoff));
    if (runs.length < 2) continue;
    const prev = runs[runs.length - 2];
    const last = runs[runs.length - 1];
    const key = `${prev[0].label}>${last[0].label}`;
    const g = groups.get(key) || { from: prev[0].label, to: last[0].label, products: 0, before: [], after: [] };
    g.products += 1;
    g.before.push(...prev);
    g.after.push(...last);
    groups.set(key, g);
  }
  return [...groups.values()].map(g => {
    const before = side(g.before);
    const after = side(g.after);
    return {
      from: g.from, to: g.to, direction: directionOf(g.from, g.to), products: g.products, before, after,
      costPerDayChange: before.costPerDay > 0 ? r4(after.costPerDay / before.costPerDay - 1) : null,
      roasChange: before.roas !== null && before.roas > 0 && after.roas !== null ? r4(after.roas / before.roas - 1) : null,
    };
  }).sort((a, b) => b.products - a.products || ORDER(a.from) - ORDER(b.from) || ORDER(a.to) - ORDER(b.to));
}

export interface StabilitySummary {
  products: number;
  bySwitches: { switches: 0 | 1 | 2 | 3; products: number; cost: number }[];  // 3 = three or more
  completedRuns: number;           // label runs that ended in a switch inside the period
  meanRunDays: number | null;      // calendar days in a label before switching (completed runs only)
  medianRunDays: number | null;
}

export interface StabilityWeek { period: string; partial?: boolean; switches: number; products: number; share: number | null }

// Label stability: how often products switch, how long a
// label holds, and per week how many active products switched.
export function stability(products: ProductDays[], start: string, end: string): { summary: StabilitySummary; weeks: StabilityWeek[] } {
  const groups = new Map<0 | 1 | 2 | 3, { products: number; cost: number }>([[0, { products: 0, cost: 0 }], [1, { products: 0, cost: 0 }], [2, { products: 0, cost: 0 }], [3, { products: 0, cost: 0 }]]);
  const runDays: number[] = [];
  const weeks = new Map<string, { products: Set<string>; switched: Set<string>; switches: number }>();
  for (const p of products) {
    const runs = runsOf(p.days);
    const switches = Math.min(3, runs.length - 1) as 0 | 1 | 2 | 3;
    const g = groups.get(switches)!;
    g.products += 1;
    g.cost += sum(p.days).cost;
    runs.forEach((run, i) => {
      if (i < runs.length - 1) runDays.push(daysBetween(run[0].date, runs[i + 1][0].date) - 1);
      if (i > 0) {
        const w = weeks.get(mondayOf(run[0].date)) || { products: new Set<string>(), switched: new Set<string>(), switches: 0 };
        w.switches += 1;
        w.switched.add(p.key);
        weeks.set(mondayOf(run[0].date), w);
      }
    });
    for (const d of p.days) {
      const key = mondayOf(d.date);
      const w = weeks.get(key) || { products: new Set<string>(), switched: new Set<string>(), switches: 0 };
      w.products.add(p.key);
      weeks.set(key, w);
    }
  }
  const sorted = [...runDays].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
  const firstWeek = mondayOf(start);
  return {
    summary: {
      products: products.length,
      bySwitches: [...groups.entries()].map(([switches, g]) => ({ switches, products: g.products, cost: r2(g.cost) })),
      completedRuns: runDays.length,
      meanRunDays: runDays.length ? Math.round((runDays.reduce((a, b) => a + b, 0) / runDays.length) * 10) / 10 : null,
      medianRunDays: median,
    },
    weeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, w]) => {
      const weekEnd = addDays(period, 6);
      return {
        period,
        ...((period === firstWeek && period < start) || weekEnd > end ? { partial: true } : {}),
        switches: w.switches,
        products: w.products.size,
        share: w.products.size ? r4(w.switched.size / w.products.size) : null,
      };
    }),
  };
}

export interface ProductInfo { id: string; title: string; image: string | null; link: string | null; type_l1: string; type_l2: string; label: string; in_feed: boolean; ads_status: string | null }

export interface BucketHistoryView {
  labelled: boolean;
  grain: 'day' | 'week';
  distribution: { moment: DistributionRow[]; current: DistributionRow[] };
  distribution_total: DistributionRow;   // both modes: same days, every product once (label = TOTAL_LABEL)
  history: HistoryPoint[];
  history_labels: string[];
  transitions: { labels: string[]; cells: TransitionCell[] };
  movers: Mover[];
  movers_count: number;
  effects: SwitchEffect[];
  effects_cutoff: string;                // last complete day used by the effects
  stability: { summary: StabilitySummary; weeks: StabilityWeek[] };
  products: Record<string, ProductInfo>; // lowercased id -> display info for every product the view mentions
  type_options: TypeOption[];
  type_filter: { isDefault: boolean; excluded: string[]; active: boolean };
}

export const MOVERS_CAP = 500;
export const TOTAL_LABEL = '__total';

export function buildBucketHistory(input: {
  tuples: LabelDayTuple[];
  feed: FeedProductInfo[];
  start: string;
  end: string;
  filter: TypeFilter;
  excludedByDefault: string[];
  lagCutoff?: string;     // last complete day (today minus the lag); defaults to the period end
}): BucketHistoryView {
  const feed = new Map<string, FeedProductInfo>();
  for (const f of [...input.feed].sort((a, b) => Number(b.feed_label === 'NL') - Number(a.feed_label === 'NL'))) {
    const key = f.item_id.trim().toLowerCase();
    if (!feed.has(key)) feed.set(key, f);
  }
  const grouped = [...groupProducts(input.tuples, feed).values()];
  const options = typeOptions(grouped.map(p => ({ id: p.key, product_type: p.type })), input.excludedByDefault);
  const effective = effectiveTypeFilter(input.filter, options, input.excludedByDefault);
  // Days without an H/S/V/Z label are left out of every bucket block;
  // a product with only such days drops out.
  const products = grouped
    .filter(p => matchesType(typeLevels(p.type), effective))
    .map(p => ({ ...p, days: p.days.filter(d => d.label !== '') }))
    .filter(p => p.days.length > 0);

  const currentLabel = (p: ProductDays) => {
    const f = feed.get(p.key);
    return f ? productLabel(f.custom_label_2) : p.days[p.days.length - 1]?.label ?? '';
  };
  const moved = movers(products, input.start, input.end);
  const grain: 'day' | 'week' = daysBetween(input.start, input.end) > 62 ? 'week' : 'day';
  const cutoff = input.lagCutoff && input.lagCutoff < input.end ? input.lagCutoff : input.end;

  const info: Record<string, ProductInfo> = {};
  const shownMovers = moved.slice(0, MOVERS_CAP);
  for (const m of shownMovers) {
    const key = m.id.toLowerCase();
    const p = products.find(x => x.key === key);
    const f = feed.get(key);
    const { l1, l2 } = typeLevels(f?.product_type || p?.type || '');
    info[key] = {
      id: m.id, title: f?.title || m.id, image: f?.image_link ?? null, link: f?.link ?? null, type_l1: l1, type_l2: l2,
      label: p ? currentLabel(p) : '', in_feed: !!f, ads_status: f?.ads_status ?? null,
    };
  }

  return {
    labelled: products.length > 0,
    grain,
    distribution: { moment: momentDistribution(products), current: currentDistribution(products, currentLabel) },
    distribution_total: {
      label: TOTAL_LABEL, name: 'Total', products: products.length, ...deriveProduct(sum(products.flatMap(p => p.days))),
      cost_share: 1, revenue_share: 1,
    },
    history: history(products, input.start, input.end, grain),
    history_labels: sortLabels(products.flatMap(p => p.days.map(d => d.label))),
    transitions: transitions(products),
    movers: shownMovers,
    movers_count: moved.length,
    effects: switchEffects(products, cutoff),
    effects_cutoff: cutoff,
    stability: stability(products, input.start, input.end),
    products: info,
    type_options: options,
    type_filter: { isDefault: effective.isDefault, excluded: effective.excluded, active: !!(effective.l1 || effective.l2) },
  };
}
