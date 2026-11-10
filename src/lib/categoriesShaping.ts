// Pure shaping for the Categories page. Runs on the server (product-type
// aggregation per bucket) and on the client (table, drill-down, chart).
// No profit, margin or POAS anywhere.
import { addDays, addRow, DateRange, Derived, derive, emptyTotals, FactRow, groupBy, Totals, withRevenueShare } from './metrics';

export const OTHER = 'Other';
export const MAX_TREND_LINES = 8;

// --- product types (an account with one campaign: categories = product_type level 1) ---

export interface ProductTypeFact {
  period: string;
  product_type_l1: string;
  product_type_l2: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

interface RawProductRow {
  product_type?: string | null;
  impressions?: number; clicks?: number; cost?: number; conversions?: number; conversions_value?: number;
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// "solar lighting > custom size > 120 cm" -> l1 "Solar lighting", l2 "Custom size".
export function splitProductType(productType: string | null | undefined): { l1: string; l2: string } {
  const parts = (productType || '').split(' > ').map(p => p.trim()).filter(Boolean);
  return { l1: parts[0] ? capitalise(parts[0]) : OTHER, l2: parts[1] ? capitalise(parts[1]) : '' };
}

// Collapses the per-item RPC output of one bucket to (period, l1, l2) rows.
export function aggregateProductRows(period: string, rows: RawProductRow[]): ProductTypeFact[] {
  const groups = new Map<string, ProductTypeFact>();
  for (const row of rows) {
    const { l1, l2 } = splitProductType(row.product_type);
    const key = `${l1}\u0000${l2}`;
    const fact = groups.get(key) || { period, product_type_l1: l1, product_type_l2: l2, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
    fact.impressions += Number(row.impressions || 0);
    fact.clicks += Number(row.clicks || 0);
    fact.cost += Number(row.cost || 0);
    fact.conversions += Number(row.conversions || 0);
    fact.conversions_value += Number(row.conversions_value || 0);
    groups.set(key, fact);
  }
  return [...groups.values()];
}

// The product RPC has no grain: it sums the daily table when the start date is
// inside the daily retention window and otherwise sums WHOLE calendar months.
// So a trend needs one call per bucket, and a bucket is only exact when it is
// a single day inside the daily window or a calendar month.
export interface ProductBucket { period: string; start: string; end: string }
export type ProductCoverage = 'daily' | 'monthly';

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso: string) => {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};

export function productBuckets(range: DateRange, dailyFloor: string | null): { grain: 'day' | 'month'; coverage: ProductCoverage; buckets: ProductBucket[] } {
  const buckets: ProductBucket[] = [];
  if (dailyFloor && range.start >= dailyFloor) {
    for (let day = range.start; day <= range.end; day = addDays(day, 1)) buckets.push({ period: day, start: day, end: day });
    return { grain: 'day', coverage: 'daily', buckets };
  }
  let month = monthStart(range.start);
  while (month <= range.end) {
    const end = monthEnd(month);
    buckets.push({ period: month, start: month, end: end < range.end ? end : range.end });
    month = addDays(end, 1);
  }
  return { grain: 'month', coverage: 'monthly', buckets };
}

// Compare buckets: exact in one call inside the daily window; whole months when
// the current period is monthly anyway; otherwise no honest comparison exists.
export function compareBuckets(compareRange: DateRange | null, dailyFloor: string | null, coverage: ProductCoverage): ProductBucket[] | null {
  if (!compareRange) return null;
  if (dailyFloor && compareRange.start >= dailyFloor) return [{ period: compareRange.start, start: compareRange.start, end: compareRange.end }];
  if (coverage === 'monthly') return productBuckets(compareRange, null).buckets;
  return null;
}

// --- rows for the table, the drill-down and the chart ---

export interface CategoryRow extends Derived {
  name: string;
  share: number | null;
  previousShare?: number | null;
  previous: Derived | null;
  target_roas: number | null;   // only when every campaign in the category shares one (admin sees it)
  items: number;                // campaigns or product subtypes
}

export interface CampaignRow extends Derived {
  category: string;
  campaign_id: string;
  name: string;
  network: string;
  bucket: string;
  status: string;
  share: number | null;
  previousShare?: number | null;
  previous: Derived | null;
  target_roas: number | null;
}

const latestByCampaign = (rows: FactRow[]) => {
  const latest = new Map<string, FactRow>();
  for (const row of rows) {
    const current = latest.get(row.campaign_id);
    if (!current || row.period > current.period) latest.set(row.campaign_id, row);
  }
  return latest;
};

// One tROAS for the group, or null when campaigns with spend disagree or have none.
export function uniformTargetRoas(rows: FactRow[]): number | null {
  const spending = rows.filter(r => Number(r.cost || 0) > 0);
  const targets = [...latestByCampaign(spending).values()].map(r => r.target_roas);
  if (targets.length === 0 || targets.some(t => t === null || t === undefined)) return null;
  return targets.every(t => t === targets[0]) ? targets[0] : null;
}

// Revenue share within the table and in the comparison period.
const withShare = <T extends { cost: number; conversions_value: number; previous: { conversions_value: number } | null }>(rows: T[]) =>
  withRevenueShare(rows).sort((a, b) => b.cost - a.cost);

export function categoryRowsFromCampaigns(rows: FactRow[], compareRows: FactRow[]): CategoryRow[] {
  const current = groupBy(rows, r => r.category);
  const previous = groupBy(compareRows, r => r.category);
  return withShare([...current.entries()].map(([name, d]) => {
    const own = rows.filter(r => r.category === name);
    return { name, ...d, share: null, previous: previous.get(name) || null, target_roas: uniformTargetRoas(own), items: new Set(own.map(r => r.campaign_id)).size };
  }));
}

export function campaignRowsFor(rows: FactRow[], compareRows: FactRow[], category: string): CampaignRow[] {
  const own = rows.filter(r => r.category === category);
  const current = groupBy(own, r => r.campaign_id);
  const previous = groupBy(compareRows.filter(r => r.category === category), r => r.campaign_id);
  const latest = latestByCampaign(own);
  return withShare([...current.entries()].map(([id, d]) => {
    const meta = latest.get(id)!;
    return {
      campaign_id: id, name: meta.campaign_name, network: meta.network, category: meta.category, bucket: meta.bucket, status: meta.status,
      ...d, share: null, previous: previous.get(id) || null, target_roas: meta.target_roas ?? null,
    };
  }));
}

export function categoryRowsFromProducts(facts: ProductTypeFact[], compareFacts: ProductTypeFact[] | null, targetRoas: number | null): CategoryRow[] {
  const current = groupBy(facts, f => f.product_type_l1);
  const previous = compareFacts ? groupBy(compareFacts, f => f.product_type_l1) : null;
  return withShare([...current.entries()].map(([name, d]) => ({
    name, ...d, share: null, previous: previous?.get(name) || null, target_roas: targetRoas,
    items: new Set(facts.filter(f => f.product_type_l1 === name).map(f => f.product_type_l2)).size,
  })));
}

export interface SubtypeRow extends Derived { name: string; share: number | null; previous: Derived | null }

export function subtypeRowsFor(facts: ProductTypeFact[], compareFacts: ProductTypeFact[] | null, l1: string): SubtypeRow[] {
  const label = (f: ProductTypeFact) => f.product_type_l2 || '(no subtype)';
  const current = groupBy(facts.filter(f => f.product_type_l1 === l1), label);
  const previous = compareFacts ? groupBy(compareFacts.filter(f => f.product_type_l1 === l1), label) : null;
  return withShare([...current.entries()].map(([name, d]) => ({ name, ...d, share: null, previous: previous?.get(name) || null })));
}

// --- trend: one line per category, top N by cost, the rest folded into Other ---

export interface TrendInput extends Partial<Totals> { period: string; name: string }
export interface TrendPoint { period: string; values: Record<string, Derived> }

export function categoryTrend(rows: TrendInput[], maxLines = MAX_TREND_LINES): { names: string[]; points: TrendPoint[] } {
  const costByName = new Map<string, number>();
  for (const row of rows) costByName.set(row.name, (costByName.get(row.name) || 0) + Number(row.cost || 0));
  const ranked = [...costByName.entries()].filter(([name]) => name !== OTHER).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const kept = ranked.slice(0, maxLines);
  const folded = ranked.length > maxLines || costByName.has(OTHER);
  const names = folded ? [...kept, OTHER] : kept;
  const resolve = (name: string) => (kept.includes(name) ? name : OTHER);

  const periods = new Map<string, Map<string, Totals>>();
  for (const row of rows) {
    const bucket = periods.get(row.period) || new Map<string, Totals>();
    const key = resolve(row.name);
    bucket.set(key, addRow(bucket.get(key) || emptyTotals(), row));
    periods.set(row.period, bucket);
  }
  const points = [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, bucket]) => ({
    period,
    values: Object.fromEntries(names.map(name => [name, derive(bucket.get(name) || emptyTotals())])),
  }));
  return { names, points };
}

export const campaignTrendInput = (rows: FactRow[]): TrendInput[] => rows.map(r => ({ ...r, name: r.category }));
export const productTrendInput = (facts: ProductTypeFact[]): TrendInput[] => facts.map(f => ({ ...f, name: f.product_type_l1 }));

export const compareLabelFor = (compare: string) => (compare === 'year' ? 'last year' : compare === 'none' ? '' : 'previous period');
