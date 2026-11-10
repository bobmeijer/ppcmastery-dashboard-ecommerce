// Pure shaping for the Products page. Runs on the server (aggregation) and on
// the client (search, chip filters). No profit, margin or POAS anywhere.
//
// the page is organised around the ProductHero buckets
// (heroes / sidekicks / villains / zombies) instead of winners / losers /
// zombies. One product list carries the current label (from the feed sync) and
// the label split inside the period (cost stays with the label of that moment).
import { safeDiv } from './metrics';
import { PRODUCT_LABEL_NAMES, productLabel } from './bucketsShaping';
import { effectiveTypeFilter, matchesType, TypeFilter, typeLevels, TypeOption, typeOptions } from './productTypes';

// One row of read_product_facts_json: product x campaign x label x country.
export interface ProductFactRow {
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  network: string;
  category: string;
  campaign_bucket: string;
  product_item_id: string;
  product_title: string | null;
  product_type: string | null;
  brand: string | null;
  custom_label_0: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  custom_label_4: string | null;
  country_code: string | null;
  impressions: number | string;
  clicks: number | string;
  cost: number | string;
  conversions: number | string;
  conversions_value: number | string;
  source: 'daily' | 'monthly';
}

// The part of a feed_products row this page needs.
export interface FeedProductInfo {
  item_id: string;
  feed_label: string;
  title: string;
  link: string | null;
  image_link: string | null;
  product_type: string | null;
  brand: string | null;
  availability: string | null;
  ads_status: string | null;
  custom_label_2: string | null;
}

export interface ProductTotals {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

export interface ProductDerived extends ProductTotals {
  ctr: number | null;
  cvr: number | null;
  roas: number | null;
  cpa: number | null;
}

export interface LabelShare { label: string; cost: number; conversions_value: number }

export interface ProductListRow extends ProductDerived {
  id: string;
  title: string;
  link: string | null;
  image: string | null;
  product_type: string;
  type_l1: string;
  type_l2: string;
  brand: string;
  availability: string | null;
  in_feed: boolean;
  ads_status: string | null;
  label: string;               // current bucket letter (feed), '' = none
  label_split: LabelShare[];   // only when the product had more than one label in the period
  revenue_share: number | null;
}

export interface BucketSummary extends ProductDerived {
  label: string;
  name: string;
  products: number;
  cost_share: number | null;
  revenue_share: number | null;
}

export interface ProductTypeRow extends ProductDerived {
  name: string;
  products: number;
  revenue_share: number | null;
  cost_share: number | null;
}

export interface ProductsReportBody {
  source: 'daily' | 'monthly' | null;
  labelled: boolean;
  products: ProductListRow[];
  totals: ProductDerived;
  buckets: BucketSummary[];
  by_type: ProductTypeRow[];
  by_type_level: 1 | 2;
  type_options: TypeOption[];
  type_filter: { isDefault: boolean; excluded: string[] };
}

const LABEL_ORDER = ['H', 'S', 'V', 'Z'];

export const emptyProductTotals = (): ProductTotals => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 });

// Rounded for the wire: money to cents, ratios to four decimals.
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

export const roundTotals = (t: ProductTotals): ProductTotals => ({
  impressions: t.impressions, clicks: t.clicks, cost: r2(t.cost), conversions: r2(t.conversions), conversions_value: r2(t.conversions_value),
});

export function deriveProduct(t: ProductTotals): ProductDerived {
  return {
    ...roundTotals(t),
    ctr: r4(safeDiv(t.clicks, t.impressions)),
    cvr: r4(safeDiv(t.conversions, t.clicks)),
    roas: r4(safeDiv(t.conversions_value, t.cost)),
    cpa: r4(safeDiv(t.cost, t.conversions)),
  };
}

const add = (target: ProductTotals, row: Partial<Record<keyof ProductTotals, number | string>>) => {
  target.impressions += Number(row.impressions || 0);
  target.clicks += Number(row.clicks || 0);
  target.cost += Number(row.cost || 0);
  target.conversions += Number(row.conversions || 0);
  target.conversions_value += Number(row.conversions_value || 0);
  return target;
};

const text = (v: string | null | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);
const idKey = (id: string) => id.trim().toLowerCase();
export const labelName = (label: string) => PRODUCT_LABEL_NAMES[label] || (label ? label : 'No label');
const labelOrder = (label: string) => {
  const i = LABEL_ORDER.indexOf(label);
  return i >= 0 ? `0${i}` : label === '' ? 'zz' : `1${label}`;
};

interface Accumulator {
  id: string;
  totals: ProductTotals;
  title: string; product_type: string; brand: string;
  labels: Map<string, ProductTotals>;
}

// Collapse product x campaign x label x country rows to one row per product.
function aggregate(rows: ProductFactRow[]): Map<string, Accumulator> {
  const products = new Map<string, Accumulator>();
  for (const row of rows) {
    // Google returns a few rows without an item id (unmapped listings); they are not a product.
    if (!row.product_item_id || !row.product_item_id.trim()) continue;
    const key = idKey(row.product_item_id);
    let acc = products.get(key);
    if (!acc) {
      acc = { id: row.product_item_id, totals: emptyProductTotals(), title: text(row.product_title, row.product_item_id), product_type: text(row.product_type, ''), brand: text(row.brand, ''), labels: new Map() };
      products.set(key, acc);
    } else {
      // Titles and types can differ per row (feed edits inside the period); keep a non-empty one.
      if (acc.title === acc.id) acc.title = text(row.product_title, acc.title);
      if (!acc.product_type) acc.product_type = text(row.product_type, '');
      if (!acc.brand) acc.brand = text(row.brand, '');
    }
    add(acc.totals, row);
    const label = productLabel(row.custom_label_2);
    acc.labels.set(label, add(acc.labels.get(label) || emptyProductTotals(), row));
  }
  return products;
}

// One feed row per item: NL before other feed labels (attributes are the same per item).
function feedIndex(feed: FeedProductInfo[]): Map<string, FeedProductInfo> {
  const index = new Map<string, FeedProductInfo>();
  for (const f of [...feed].sort((a, b) => Number(b.feed_label === 'NL') - Number(a.feed_label === 'NL'))) {
    const key = idKey(f.item_id);
    if (!index.has(key)) index.set(key, f);
  }
  return index;
}

// Biggest label in the period, for products that left the feed.
const dominantLabel = (labels: Map<string, ProductTotals>) =>
  [...labels.entries()].sort(([, a], [, b]) => b.cost - a.cost || b.impressions - a.impressions)[0]?.[0] ?? '';

// includeFeedOnly: feed products without facts join the list (zombies with zero traffic).
// The feed is Google's Merchant Center, so a Microsoft view lists only products with
// Microsoft facts.
function toRows(products: Map<string, Accumulator>, feed: Map<string, FeedProductInfo>, includeFeedOnly = true): ProductListRow[] {
  const rows: ProductListRow[] = [];
  const keys = new Set([...products.keys(), ...(includeFeedOnly ? feed.keys() : [])]);
  for (const key of keys) {
    const acc = products.get(key);
    const f = feed.get(key);
    const totals = acc?.totals || emptyProductTotals();
    const productType = text(f?.product_type, acc?.product_type || '');
    const { l1, l2 } = typeLevels(productType);
    const split = acc && acc.labels.size > 1
      ? [...acc.labels.entries()].map(([label, t]) => ({ label, cost: r2(t.cost), conversions_value: r2(t.conversions_value) })).sort((a, b) => labelOrder(a.label).localeCompare(labelOrder(b.label)))
      : [];
    rows.push({
      id: acc ? acc.id : f!.item_id,
      title: text(f?.title, acc?.title || f?.item_id || key),
      link: f?.link ?? null,
      image: f?.image_link ?? null,
      product_type: productType,
      type_l1: l1,
      type_l2: l2,
      brand: text(f?.brand, acc?.brand || ''),
      availability: f?.availability ?? null,
      in_feed: !!f,
      ads_status: f?.ads_status ?? null,
      label: f ? productLabel(f.custom_label_2) : dominantLabel(acc!.labels),
      label_split: split,
      ...deriveProduct(totals),
      revenue_share: null,
    });
  }
  return rows;
}

function sumProducts(rows: ProductTotals[]): ProductTotals {
  return rows.reduce((acc, r) => add(acc, r), emptyProductTotals());
}

export function bucketSummaries(rows: ProductListRow[], totals: ProductTotals): BucketSummary[] {
  const groups = new Map<string, ProductListRow[]>();
  for (const r of rows) groups.set(r.label, [...(groups.get(r.label) || []), r]);
  return [...groups.entries()]
    .sort(([a], [b]) => labelOrder(a).localeCompare(labelOrder(b)))
    .map(([label, list]) => {
      const t = sumProducts(list);
      return {
        label, name: labelName(label), products: list.length, ...deriveProduct(t),
        cost_share: totals.cost > 0 ? r4(t.cost / totals.cost) : null,
        revenue_share: totals.conversions_value > 0 ? r4(t.conversions_value / totals.conversions_value) : null,
      };
    });
}

export function byProductType(rows: ProductListRow[], totals: ProductTotals, level: 1 | 2): ProductTypeRow[] {
  const groups = new Map<string, ProductListRow[]>();
  for (const r of rows) {
    const name = level === 1 ? r.type_l1 : r.type_l2 || '(no level 2)';
    groups.set(name, [...(groups.get(name) || []), r]);
  }
  return [...groups.entries()].map(([name, list]) => {
    const t = sumProducts(list);
    return {
      name, products: list.length, ...deriveProduct(t),
      revenue_share: totals.conversions_value > 0 ? r4(t.conversions_value / totals.conversions_value) : null,
      cost_share: totals.cost > 0 ? r4(t.cost / totals.cost) : null,
    };
  }).sort((a, b) => b.conversions_value - a.conversions_value || b.cost - a.cost);
}

// Server-side entry point: period facts plus the latest feed, filtered on product type.
export function buildProductsReport(rows: ProductFactRow[], feed: FeedProductInfo[] = [], filter: TypeFilter = { l1: null, l2: [] }, excludedByDefault: string[] = [], includeFeedOnly = true): ProductsReportBody {
  const all = toRows(aggregate(rows), feedIndex(feed), includeFeedOnly);
  const options = typeOptions(all.map(r => ({ id: r.id, product_type: r.product_type })), excludedByDefault);
  const effective = effectiveTypeFilter(filter, options, excludedByDefault);
  const products = all.filter(r => matchesType({ l1: r.type_l1, l2: r.type_l2 }, effective));
  const totals = sumProducts(products);
  for (const r of products) r.revenue_share = totals.conversions_value > 0 ? r4(r.conversions_value / totals.conversions_value) : null;
  const level: 1 | 2 = effective.l1 && effective.l1.size === 1 ? 2 : 1;
  return {
    source: rows.length ? rows[0].source : null,
    labelled: products.some(r => r.label !== ''),
    products: products.sort((a, b) => b.conversions_value - a.conversions_value || b.cost - a.cost || b.impressions - a.impressions),
    totals: deriveProduct(totals),
    buckets: bucketSummaries(products, totals),
    by_type: byProductType(products, totals, level),
    by_type_level: level,
    type_options: options,
    type_filter: { isDefault: effective.isDefault, excluded: effective.excluded },
  };
}

// --- client helpers ------------------------------------------------------------

export function searchProducts<T extends { title: string; id: string; brand?: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || (r.brand || '').toLowerCase().includes(q));
}

// Chip filter on the product list: a bucket letter ('' = no label) or everything.
export type ProductChip = { kind: 'all' } | { kind: 'label'; label: string };

export function applyChip(rows: ProductListRow[], chip: ProductChip): ProductListRow[] {
  if (chip.kind === 'label') return rows.filter(r => r.label === chip.label);
  return rows;
}
