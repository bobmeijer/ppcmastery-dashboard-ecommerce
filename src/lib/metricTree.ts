// Ecommerce metric tree, built around finding the
// binding constraint: before the click, the
// click, after the click. Drawn as a funnel: the volume
// chain down the centre, rates between the stages, side metrics beside them.
// Pure, tested in metricTree.test.ts.
//
// The tree shows values, the comparison and the change only. It does not
// mark a constraint: "the largest percentage drop is not automatically the
// binding constraint" . No profit layer
// (client decision: no profit, margin or POAS).
import { change, Derived, formatMetricDelta, sumRows, Totals } from './metrics';

export type TreeBucket = 'traffic' | 'creative' | 'conversion' | 'business' | 'derived';
export type TreeKind = 'count' | 'rate' | 'derived';
export type TreeNodeKey =
  | 'rank_lost_is' | 'budget_lost_is' | 'eligible_impressions' | 'impression_share' | 'impressions'
  | 'ctr' | 'clicks' | 'cpc' | 'cost'
  | 'cvr' | 'conversions' | 'aov' | 'conversions_value' | 'cpa' | 'roas';

export interface TreeNodeDef {
  key: TreeNodeKey;
  label: string;
  formula: string;
  bucket: TreeBucket;
  kind: TreeKind;
  higherIsBetter: boolean | null;   // null = neutral (spend is never judged)
  lagging: boolean;
}

// Levers, the buckets used to find the binding
// constraint: the colour of a metric is the lever that moves it. The rates are
// the levers themselves; a volume takes the colour of the rate that feeds it.
// CPC, cost, CPA and ROAS are outcomes, not levers (grey). Not to be confused
// with the ProductHero buckets (H / S / V / Z) on the Buckets page.
export const LEVERS: { bucket: TreeBucket; label: string; text: string }[] = [
  { bucket: 'traffic', label: 'Traffic', text: 'Reach in the auction: impression share and Lost IS. Steered with bid, budget and ad rank.' },
  { bucket: 'creative', label: 'Creative', text: 'How many impressions become a click: CTR. Steered with ads, assets and relevance to the search term.' },
  { bucket: 'conversion', label: 'Conversion', text: 'How many clicks become a purchase: conversion rate. Steered with landing page, offer and search intent.' },
  { bucket: 'business', label: 'Business', text: 'What a purchase brings in: AOV. Steered with range, price and bundles.' },
  { bucket: 'derived', label: 'Outcome', text: 'Arithmetic outcomes (CPC, Cost, CPA, ROAS): the result of the levers, not a lever of their own.' },
];

export const TREE_NODES: TreeNodeDef[] = [
  { key: 'rank_lost_is', label: 'Lost IS (rank)', formula: 'Share of impressions you missed because of ad rank (bid, quality). Search and Shopping only.', bucket: 'traffic', kind: 'rate', higherIsBetter: false, lagging: false },
  { key: 'budget_lost_is', label: 'Lost IS (budget)', formula: 'Share of impressions you missed because the budget ran out. Search and Shopping only.', bucket: 'traffic', kind: 'rate', higherIsBetter: false, lagging: false },
  { key: 'eligible_impressions', label: 'Eligible impr.', formula: 'Impressions you were eligible for: impressions divided by impression share. Search and Shopping only.', bucket: 'traffic', kind: 'count', higherIsBetter: true, lagging: false },
  { key: 'impression_share', label: 'Impr. share', formula: 'Impressions divided by eligible impressions; roughly 1 minus Lost IS (rank) minus Lost IS (budget). Search and Shopping only.', bucket: 'traffic', kind: 'rate', higherIsBetter: true, lagging: false },
  { key: 'impressions', label: 'Impressions', formula: 'Eligible impressions times impression share (for Search and Shopping).', bucket: 'traffic', kind: 'count', higherIsBetter: true, lagging: false },
  { key: 'ctr', label: 'CTR', formula: 'Clicks divided by impressions.', bucket: 'creative', kind: 'rate', higherIsBetter: true, lagging: false },
  { key: 'clicks', label: 'Clicks', formula: 'Impressions times CTR.', bucket: 'creative', kind: 'count', higherIsBetter: true, lagging: false },
  { key: 'cpc', label: 'CPC', formula: 'Cost divided by clicks.', bucket: 'derived', kind: 'derived', higherIsBetter: false, lagging: false },
  { key: 'cost', label: 'Cost', formula: 'Clicks times CPC.', bucket: 'derived', kind: 'count', higherIsBetter: null, lagging: false },
  { key: 'cvr', label: 'Conv. rate', formula: 'Purchases divided by clicks.', bucket: 'conversion', kind: 'rate', higherIsBetter: true, lagging: true },
  { key: 'conversions', label: 'Conversions', formula: 'Clicks times conversion rate.', bucket: 'conversion', kind: 'count', higherIsBetter: true, lagging: true },
  { key: 'aov', label: 'AOV', formula: 'Average order value: revenue divided by purchases.', bucket: 'business', kind: 'rate', higherIsBetter: true, lagging: true },
  { key: 'conversions_value', label: 'Conv. value', formula: 'Purchases times AOV.', bucket: 'business', kind: 'count', higherIsBetter: true, lagging: true },
  { key: 'cpa', label: 'CPA', formula: 'Cost divided by purchases (= CPC divided by conversion rate).', bucket: 'derived', kind: 'derived', higherIsBetter: false, lagging: true },
  { key: 'roas', label: 'ROAS', formula: 'Revenue divided by cost (= conversion rate times AOV divided by CPC).', bucket: 'derived', kind: 'derived', higherIsBetter: true, lagging: true },
];

// Funnel layout, top to bottom: a stage per volume, a link (the rate on the
// line) between two stages, side metrics left and right of a stage.
export type FunnelRow =
  | { kind: 'stage'; key: TreeNodeKey; width: number; left: TreeNodeKey[]; right: TreeNodeKey[] }
  | { kind: 'link'; key: TreeNodeKey };

export const FUNNEL_ROWS: FunnelRow[] = [
  { kind: 'stage', key: 'eligible_impressions', width: 100, left: [], right: [] },
  { kind: 'link', key: 'impression_share' },
  { kind: 'stage', key: 'impressions', width: 92, left: ['rank_lost_is', 'budget_lost_is'], right: [] },
  { kind: 'link', key: 'ctr' },
  { kind: 'stage', key: 'clicks', width: 84, left: [], right: ['cpc', 'cost'] },
  { kind: 'link', key: 'cvr' },
  { kind: 'stage', key: 'conversions', width: 76, left: [], right: ['cpa'] },
  { kind: 'link', key: 'aov' },
  { kind: 'stage', key: 'conversions_value', width: 68, left: [], right: ['roas'] },
];

// Band -> first and last grid row (1-based); the label sits in the left cell of the first row.
export const FUNNEL_BANDS = [
  { label: 'Before the click', from: 1, to: 3 },
  { label: 'The click', from: 4, to: 5 },
  { label: 'After the click', from: 6, to: 9 },
];

export interface TreeNodeValue extends TreeNodeDef {
  value: number | null;
  previous: number | null;
  change: number | null;      // relative change, null without comparison
  tone: 'good' | 'bad' | null;
}

export interface MetricTreeView {
  nodes: TreeNodeValue[];
  isCoverage: number | null;  // share of impressions in campaigns with impression share data
  hasCompare: boolean;
}

// Share of impressions that sit in rows with eligible impressions (Search and Shopping).
function coverage(rows: Partial<Totals>[]): number | null {
  const all = rows.reduce((a, r) => a + Number(r.impressions || 0), 0);
  if (all <= 0) return null;
  const covered = rows.filter(r => Number(r.eligible_impressions || 0) > 0).reduce((a, r) => a + Number(r.impressions || 0), 0);
  return covered / all;
}

// Impression share and lost IS only make sense over the campaigns that report them,
// so they are derived from the covered rows; everything else from all rows.
function valuesFor(rows: Partial<Totals>[]): Record<TreeNodeKey, number | null> {
  const all: Derived = sumRows(rows);
  const covered: Derived = sumRows(rows.filter(r => Number(r.eligible_impressions || 0) > 0));
  return {
    rank_lost_is: covered.rank_lost_is, budget_lost_is: covered.budget_lost_is,
    eligible_impressions: covered.eligible_impressions > 0 ? covered.eligible_impressions : null,
    impression_share: covered.impression_share, impressions: all.impressions,
    ctr: all.ctr, clicks: all.clicks, cpc: all.cpc, cost: all.cost,
    cvr: all.cvr, conversions: all.conversions, aov: all.aov, conversions_value: all.conversions_value,
    cpa: all.cpa, roas: all.roas,
  };
}

export function buildMetricTree(rows: Partial<Totals>[], compareRows: Partial<Totals>[] | null): MetricTreeView {
  const current = valuesFor(rows);
  const previous = compareRows && compareRows.length ? valuesFor(compareRows) : null;
  return {
    hasCompare: !!previous,
    isCoverage: coverage(rows),
    nodes: TREE_NODES.map(def => {
      const value = current[def.key];
      const prev = previous ? previous[def.key] : null;
      const delta = previous ? change(value, prev) : null;
      const tone = delta === null || delta === 0 || def.higherIsBetter === null ? null : (delta > 0) === def.higherIsBetter ? 'good' : 'bad';
      return { ...def, value, previous: prev, change: delta, tone };
    }),
  };
}

// --- Contributions ------------------------------------------------------------
// Revenue is exactly Impressions x CTR x Conv. rate x AOV, and ROAS exactly
// Conv. rate x AOV / CPC. A change in such a product splits without remainder
// over its factors with the logarithmic mean (LMDI): factor i gets
// L(T1, T0) x ln(f1 / f0), where L(a, b) = (a - b) / ln(a / b). The parts add
// up to T1 - T0. Arithmetic, not a diagnosis: the largest part is not
// automatically the binding constraint (workbook rule).

// 'days' is the calendar factor when the two periods differ in length (30 vs 31 days).
export type BridgeKey = TreeNodeKey | 'days';

export interface Contribution {
  key: BridgeKey;
  change: number;   // relative change of the factor itself
  amount: number;   // part of the total change, in the unit of the total
}

export interface Bridge {
  total: 'conversions_value' | 'roas';
  current: number;
  previous: number;
  parts: Contribution[];  // in funnel order
}

const logMean = (a: number, b: number) => (Math.abs(a - b) < 1e-12 * Math.max(a, b) ? a : (a - b) / Math.log(a / b));

type Factors = Partial<Record<BridgeKey, number | null>>;

function bridge(total: Bridge['total'], cur: Factors, prev: Factors, factors: { key: BridgeKey; power: 1 | -1 }[]): Bridge | null {
  const t1 = cur[total];
  const t0 = prev[total];
  if (!(t1 && t1 > 0 && t0 && t0 > 0)) return null;
  const parts: Contribution[] = [];
  for (const { key, power } of factors) {
    const f1 = cur[key];
    const f0 = prev[key];
    if (!(f1 && f1 > 0 && f0 && f0 > 0)) return null;
    parts.push({ key, change: f1 / f0 - 1, amount: logMean(t1, t0) * power * Math.log(f1 / f0) });
  }
  return { total, current: t1, previous: t0, parts };
}

// With periods of unequal length the volume is compared per day and the day
// count becomes its own factor: Revenue = Days x Impressions per day x CTR x CVR x AOV.
export function revenueBridge(cur: Factors, prev: Factors, days?: { current: number; previous: number }): Bridge | null {
  const rates = [{ key: 'ctr', power: 1 }, { key: 'cvr', power: 1 }, { key: 'aov', power: 1 }] as const;
  if (!days || days.current === days.previous || days.current <= 0 || days.previous <= 0) {
    return bridge('conversions_value', cur, prev, [{ key: 'impressions', power: 1 }, ...rates]);
  }
  const perDay = (f: Factors, n: number) => ({ ...f, days: n, impressions: f.impressions == null ? null : f.impressions / n });
  return bridge('conversions_value', perDay(cur, days.current), perDay(prev, days.previous), [{ key: 'days', power: 1 }, { key: 'impressions', power: 1 }, ...rates]);
}

export const roasBridge = (cur: Factors, prev: Factors) =>
  bridge('roas', cur, prev, [{ key: 'cpc', power: -1 }, { key: 'cvr', power: 1 }, { key: 'aov', power: 1 }]);

// Largest parts first (by size, either direction).
export const largestParts = (b: Bridge, n = 2) => [...b.parts].sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)).slice(0, n);

// A contribution as text: euros for revenue, points for ROAS, always signed.
export const fmtPart = (total: Bridge['total'], amount: number) => {
  const text = formatMetricDelta(total, amount);
  return amount > 0 ? `+${text}` : text;
};
