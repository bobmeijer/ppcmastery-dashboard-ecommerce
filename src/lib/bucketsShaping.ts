// Pure shaping for the Buckets page (ProductHero performance buckets).
// Runs on both server and client; tested in bucketsShaping.test.ts.
//
// Two bucket notions live side by side:
// - campaign bucket: the bracket in the campaign name ("08 | Garden Chairs [H+S]"),
//   exposed by the campaign facts as `bucket` ("H+S", "V+Z", "All", "Boost", "Z", "H+S+V", "V", "").
// - product bucket: the single letter in custom_label_2 on the product (H / S / V / Z).
import { addRow, Derived, derive, emptyTotals, FactRow, sumRows, Totals } from './metrics';

// Client-safe row type for read_product_facts_json (the server reader re-exports it).
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
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  source: 'daily' | 'monthly';
}

// --- campaign buckets ------------------------------------------------------------

// Matrix column order. Other only shows
// when a bracket holds an unknown combination.
export const BUCKET_GROUPS = ['H+S', 'H+S+V', 'V+Z', 'V', 'Z', 'All', 'Boost', 'Other'] as const;
export type BucketGroup = (typeof BUCKET_GROUPS)[number];

// Old full-word names map onto their letter ([Villains] = V, [Zombies] = Z).
const BUCKET_ALIASES: Record<string, string> = { heroes: 'H', sidekicks: 'S', villains: 'V', zombies: 'Z' };
// Brackets that are not a bucket but a bidding note (02 | Chairs [tCPA]).
const NOT_A_BUCKET = new Set(['tcpa', 'troas', 'maxconv', 'maxconvvalue', 'cpc']);

// Maps a raw campaign bucket onto a matrix column. Empty or a bidding note =
// no bucket (Search, Display, unbracketed Shopping), which stays out of the matrix.
export function bucketGroup(bucket: string | null | undefined): BucketGroup | null {
  const raw = (bucket || '').trim().toLowerCase();
  if (!raw || NOT_A_BUCKET.has(raw)) return null;
  const normalised = BUCKET_ALIASES[raw] || raw;
  const known = BUCKET_GROUPS.find(g => g !== 'Other' && g.toLowerCase() === normalised.toLowerCase());
  return known || 'Other';
}

// --- category x bucket matrix ----------------------------------------------------

export interface MatrixRow {
  category: string;
  cells: Partial<Record<BucketGroup, Derived>>;
  total: Derived;
}

export interface BucketMatrix {
  columns: BucketGroup[];
  rows: MatrixRow[];                           // sorted by cost, descending
  columnTotals: Partial<Record<BucketGroup, Derived>>;
  total: Derived;
}

export function bucketMatrix(rows: FactRow[]): BucketMatrix {
  const bucketedRows = rows.filter(r => bucketGroup(r.bucket) !== null);
  const byCategory = new Map<string, Map<BucketGroup, Totals>>();
  const columnTotals = new Map<BucketGroup, Totals>();
  for (const row of bucketedRows) {
    const group = bucketGroup(row.bucket)!;
    const cells = byCategory.get(row.category) || new Map<BucketGroup, Totals>();
    cells.set(group, addRow(cells.get(group) || emptyTotals(), row));
    byCategory.set(row.category, cells);
    columnTotals.set(group, addRow(columnTotals.get(group) || emptyTotals(), row));
  }
  const columns = BUCKET_GROUPS.filter(g => columnTotals.has(g));
  const matrixRows: MatrixRow[] = [...byCategory.entries()].map(([category, cells]) => {
    const out: Partial<Record<BucketGroup, Derived>> = {};
    for (const [group, totals] of cells) out[group] = derive(totals);
    return { category, cells: out, total: sumRows([...cells.values()]) };
  }).sort((a, b) => b.total.cost - a.total.cost);
  const totalsOut: Partial<Record<BucketGroup, Derived>> = {};
  for (const [group, totals] of columnTotals) totalsOut[group] = derive(totals);
  return { columns, rows: matrixRows, columnTotals: totalsOut, total: sumRows(bucketedRows) };
}


// --- product buckets (custom_label_2) --------------------------------------------

export const PRODUCT_LABEL_NAMES: Record<string, string> = {
  H: 'Heroes',
  S: 'Sidekicks',
  V: 'Villains',
  Z: 'Zombies',
};

// ProductHero writes the full bucket word into custom_label_2 ("heroes",
// "sidekicks", "villains", "zombies"); some feeds carry the letter. Both map
// onto one letter; anything else is kept as-is (uppercased) so odd values show up.
const LABEL_WORDS: Record<string, string> = {
  HEROES: 'H', HERO: 'H', SIDEKICKS: 'S', SIDEKICK: 'S', VILLAINS: 'V', VILLAIN: 'V', ZOMBIES: 'Z', ZOMBIE: 'Z',
};

export function productLabel(raw: string | null | undefined): string {
  const value = (raw || '').trim().toUpperCase();
  return LABEL_WORDS[value] || value;
}
