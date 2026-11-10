// Pure core of the feed sync: merge Google Ads shopping_product rows with
// Merchant API products into one row per product per feed label, then derive
// the Feed status snapshot (totals, destinations, issues, work list).
// Tested in feedBuild.test.ts; the fetching lives in src/lib/googleAds/feedProducts.ts.
import type { FeedDestination, FeedHistoryPoint, FeedIssue, FeedItem, FeedLabel, FeedSnapshot, FeedTotals, IssueSeverity } from './feedShaping';
import { FEED_ISSUE_TEXT, FEED_ISSUE_FALLBACK_ACTION } from './feedIssues';

export type AdsStatus = 'ELIGIBLE' | 'ELIGIBLE_LIMITED' | 'NOT_ELIGIBLE';
export type MerchantStatus = 'APPROVED' | 'PENDING' | 'DISAPPROVED';

export interface ProductIssue {
  code: string;
  source: 'ads' | 'merchant';
  severity: IssueSeverity;
  description: string;   // Google's own text (English); display copy comes from feedIssues.ts
}

// Shared attribute block of both sources.
interface ProductAttributes {
  feed_label: string;
  item_id: string;
  title: string;
  image_link: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;     // IN_STOCK | OUT_OF_STOCK | PREORDER | BACKORDER
  brand: string | null;
  product_type: string | null;     // "l1 > l2 > l3"
  custom_label_0: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  custom_label_4: string | null;
}

export interface AdsProduct extends ProductAttributes {
  status: AdsStatus | null;
  issues: ProductIssue[];
}

export interface MerchantProduct extends ProductAttributes {
  link: string | null;
  // Verdict per reporting context (SHOPPING_ADS, FREE_LISTINGS, ...).
  destinations: Record<string, MerchantStatus | null>;
  issues: ProductIssue[];           // SHOPPING_ADS-scoped item issues only
}

export interface FeedProductRow extends ProductAttributes {
  link: string | null;
  ads_status: AdsStatus | null;
  merchant_status: MerchantStatus | null;
  issues: ProductIssue[];
}

const key = (p: { feed_label: string; item_id: string }) => `${p.feed_label.toUpperCase()}|${p.item_id.toLowerCase()}`;
const pick = <T>(a: T | null | undefined, b: T | null | undefined): T | null => (a !== null && a !== undefined && a !== '' ? a : b ?? null);

// Blocking wins over warning; one entry per code.
function mergeIssues(...lists: ProductIssue[][]): ProductIssue[] {
  const byCode = new Map<string, ProductIssue>();
  for (const issue of lists.flat()) {
    const current = byCode.get(issue.code);
    if (!current || (current.severity === 'warning' && issue.severity === 'blocking')) byCode.set(issue.code, issue);
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

// Google Ads decides what serves, so its attributes lead; Merchant fills the
// gaps (landing page, attributes of products Google Ads does not list).
export function mergeFeedProducts(ads: AdsProduct[], merchant: MerchantProduct[]): FeedProductRow[] {
  const merchantByKey = new Map(merchant.map(m => [key(m), m]));
  const rows: FeedProductRow[] = [];
  const seen = new Set<string>();
  for (const a of ads) {
    const k = key(a);
    if (seen.has(k)) continue;
    seen.add(k);
    const m = merchantByKey.get(k);
    rows.push({
      feed_label: a.feed_label,
      item_id: a.item_id,
      title: pick(a.title, m?.title) || a.item_id,
      link: m?.link ?? null,
      image_link: pick(a.image_link, m?.image_link),
      price: pick(a.price, m?.price),
      currency: pick(a.currency, m?.currency),
      availability: pick(a.availability, m?.availability),
      brand: pick(a.brand, m?.brand),
      product_type: pick(a.product_type, m?.product_type),
      custom_label_0: pick(a.custom_label_0, m?.custom_label_0),
      custom_label_1: pick(a.custom_label_1, m?.custom_label_1),
      custom_label_2: pick(a.custom_label_2, m?.custom_label_2),
      custom_label_3: pick(a.custom_label_3, m?.custom_label_3),
      custom_label_4: pick(a.custom_label_4, m?.custom_label_4),
      ads_status: a.status,
      merchant_status: m ? m.destinations.SHOPPING_ADS ?? null : null,
      issues: mergeIssues(a.issues, m?.issues || []),
    });
  }
  for (const m of merchant) {
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({
      ...m,
      title: m.title || m.item_id,
      ads_status: null,
      merchant_status: m.destinations.SHOPPING_ADS ?? null,
      issues: mergeIssues(m.issues),
    });
  }
  return rows.sort((a, b) => a.item_id.localeCompare(b.item_id) || a.feed_label.localeCompare(b.feed_label));
}

export function feedTotals(rows: FeedProductRow[]): FeedTotals {
  const inAds = rows.filter(r => r.ads_status !== null);
  const inMerchant = rows.filter(r => r.merchant_status !== null);
  const count = (list: FeedProductRow[], test: (r: FeedProductRow) => boolean) => list.filter(test).length;
  return {
    // Without Google Ads rows (no Shopping/PMax yet) the feed size falls back to Merchant.
    itemsInFeed: inAds.length > 0 ? inAds.length : inMerchant.length,
    eligible: count(inAds, r => r.ads_status === 'ELIGIBLE' || r.ads_status === 'ELIGIBLE_LIMITED'),
    blocked: count(inAds, r => r.ads_status === 'NOT_ELIGIBLE'),
    pending: count(inMerchant, r => r.merchant_status === 'PENDING'),
    merchantProducts: inMerchant.length,
    merchantApproved: count(inMerchant, r => r.merchant_status === 'APPROVED'),
    merchantDisapproved: count(inMerchant, r => r.merchant_status === 'DISAPPROVED'),
    merchantPending: count(inMerchant, r => r.merchant_status === 'PENDING'),
  };
}

const DESTINATIONS: { destination: string; label: string }[] = [
  { destination: 'SHOPPING_ADS', label: 'Shopping ads' },
  { destination: 'FREE_LISTINGS', label: 'Free listings' },
];

export function feedDestinations(merchant: MerchantProduct[]): FeedDestination[] {
  return DESTINATIONS.map(d => {
    const statuses = merchant.map(m => m.destinations[d.destination] ?? null);
    return {
      ...d,
      active: statuses.filter(s => s === 'APPROVED').length,
      pending: statuses.filter(s => s === 'PENDING').length,
      disapproved: statuses.filter(s => s === 'DISAPPROVED').length,
    };
  }).filter(d => d.active + d.pending + d.disapproved > 0);
}

export function feedIssues(rows: FeedProductRow[]): FeedIssue[] {
  const byCode = new Map<string, FeedIssue & { english: string }>();
  for (const row of rows) {
    for (const issue of row.issues) {
      const text = FEED_ISSUE_TEXT[issue.code];
      const current = byCode.get(issue.code) || {
        code: issue.code,
        description: text?.description || issue.description || issue.code.replace(/_/g, ' '),
        action: text?.action || FEED_ISSUE_FALLBACK_ACTION,
        severity: issue.severity,
        products: 0,
        blocked: 0,
        english: issue.description,
      };
      current.products += 1;
      if (row.ads_status === 'NOT_ELIGIBLE') current.blocked += 1;
      if (issue.severity === 'blocking') current.severity = 'blocking';
      byCode.set(issue.code, current);
    }
  }
  return [...byCode.values()].map(({ english: _english, ...issue }) => issue);
}

export const ITEM_CAP = 200;

// Work list: products Google Ads will not serve, biggest problems first.
export function blockedItems(rows: FeedProductRow[], multipleLabels: boolean): { items: FeedItem[]; total: number } {
  const blocked = rows.filter(r => r.ads_status === 'NOT_ELIGIBLE');
  const items = blocked
    .map(r => ({
      offerId: r.item_id,
      feedLabel: multipleLabels ? r.feed_label : null,
      title: r.title,
      link: r.link,
      issueCodes: r.issues.map(i => i.code),
      adsStatus: 'NOT_ELIGIBLE' as const,
      merchantStatus: r.merchant_status || 'UNKNOWN',
      availability: r.availability,
    }))
    .sort((a, b) => b.issueCodes.length - a.issueCodes.length || a.offerId.localeCompare(b.offerId));
  return { items: items.slice(0, ITEM_CAP), total: blocked.length };
}

export interface FeedDailyRow { date: string; totals: FeedTotals; by_destination: FeedDestination[] }

export function feedHistory(daily: FeedDailyRow[]): FeedHistoryPoint[] {
  return daily.map(d => ({ date: d.date, eligible: d.totals.eligible, blocked: d.totals.blocked }));
}

export function buildFeedSnapshot(input: {
  label: FeedLabel;
  merchantId: string;
  rows: FeedProductRow[];
  daily: FeedDailyRow[];
  fetchedAt: string;
}): FeedSnapshot {
  const latest = input.daily[input.daily.length - 1];
  const labels = new Set(input.rows.map(r => r.feed_label));
  const { items, total } = blockedItems(input.rows, labels.size > 1);
  return {
    label: input.label,
    merchantId: input.merchantId,
    source: 'merchant-sync',
    snapshotDate: latest?.date || input.fetchedAt.slice(0, 10),
    fetchedAt: input.fetchedAt,
    totals: feedTotals(input.rows),
    byDestination: latest?.by_destination || [],
    issues: feedIssues(input.rows),
    items,
    itemsTotal: total,
    history: feedHistory(input.daily),
    audit: null,
  };
}
