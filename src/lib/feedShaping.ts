// Client-safe types and pure shaping for the Feed status page. The shapes below are the contract the
// Merchant API sync.

export type FeedLabel = string;
export type IssueSeverity = 'blocking' | 'warning';

export interface FeedIssue {
  code: string;
  description: string; // client-visible
  action: string;      // one-line fix instruction
  severity: IssueSeverity;
  products: number;    // products carrying the code (Merchant + Google Ads, deduplicated)
  blocked: number;     // of those, how many are NOT_ELIGIBLE in Google Ads
}

export interface FeedItem {
  offerId: string;
  feedLabel?: string | null; // set when the account has more than one feed label
  title: string;
  link: string | null;
  issueCodes: string[];
  adsStatus: 'ELIGIBLE' | 'NOT_ELIGIBLE';
  merchantStatus: string;
  availability: string | null;
}

export interface FeedDestination {
  destination: string;
  label: string;
  active: number;
  pending: number;
  disapproved: number;
}

export interface FeedModuleScore { id: string; label: string; score: number | null; weight: number }
export interface FeedAudit { generatedAt: string | null; combined: number | null; modules: FeedModuleScore[] }
export interface FeedHistoryPoint { date: string; eligible: number; blocked: number }

export interface FeedTotals {
  itemsInFeed: number;
  eligible: number;
  blocked: number;
  pending: number;
  merchantProducts: number;
  merchantApproved: number;
  merchantDisapproved: number;
  merchantPending: number;
}

export interface FeedSnapshot {
  label: FeedLabel;
  merchantId: string;
  source: 'merchant-sync';
  snapshotDate: string; // YYYY-MM-DD
  fetchedAt: string;    // ISO timestamp
  totals: FeedTotals;
  byDestination: FeedDestination[];
  issues: FeedIssue[];
  items: FeedItem[];    // blocked items only, capped
  itemsTotal: number;   // blocked items before the cap
  history: FeedHistoryPoint[];
  audit: FeedAudit | null; // null for the client role
}

// Decision in the brief: blocked share above 5% turns the tile red.
export const BLOCKED_SHARE_ALARM = 0.05;
export const STALE_SNAPSHOT_DAYS = 2;

export interface FeedSummary {
  itemsInFeed: number;
  eligible: number;
  eligibleShare: number | null;
  blocked: number;
  blockedShare: number | null;
  blockedAlarm: boolean;
  pending: number;
}

const share = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

export function summarize(snapshot: Pick<FeedSnapshot, 'totals'>): FeedSummary {
  const t = snapshot.totals;
  const blockedShare = share(t.blocked, t.itemsInFeed);
  return {
    itemsInFeed: t.itemsInFeed,
    eligible: t.eligible,
    eligibleShare: share(t.eligible, t.itemsInFeed),
    blocked: t.blocked,
    blockedShare,
    blockedAlarm: blockedShare !== null && blockedShare > BLOCKED_SHARE_ALARM,
    pending: t.pending,
  };
}

export interface IssueRow extends FeedIssue { share: number | null }

// Blocking codes first, then by affected products. Share is against items in the feed.
export function issueRows(snapshot: Pick<FeedSnapshot, 'issues' | 'totals'>): IssueRow[] {
  return [...snapshot.issues]
    .map(issue => ({ ...issue, share: share(issue.products, snapshot.totals.itemsInFeed) }))
    .sort((a, b) => (a.severity === b.severity ? b.products - a.products || a.code.localeCompare(b.code) : a.severity === 'blocking' ? -1 : 1));
}

// The same offer id can sit in two feeds (NL and BE); the key keeps them apart.
export const itemKey = (item: Pick<FeedItem, 'offerId' | 'feedLabel'>) => (item.feedLabel ? `${item.feedLabel}:${item.offerId}` : item.offerId);

export const issueIndex =(issues: FeedIssue[]): Map<string, FeedIssue> => new Map(issues.map(i => [i.code, i]));

export function describeIssue(code: string, index: Map<string, FeedIssue>): string {
  return index.get(code)?.description ?? code.replace(/_/g, ' ');
}

// An item is blocking when any of its codes is; warning otherwise.
export function itemSeverity(item: Pick<FeedItem, 'issueCodes'>, index: Map<string, FeedIssue>): IssueSeverity {
  return item.issueCodes.some(code => index.get(code)?.severity === 'blocking') ? 'blocking' : 'warning';
}

export interface ItemFilter { issue?: string | null; query?: string | null }

export function filterItems(items: FeedItem[], filter: ItemFilter, index?: Map<string, FeedIssue>): FeedItem[] {
  const issue = filter.issue || null;
  const query = (filter.query || '').trim().toLowerCase();
  return items.filter(item => {
    if (issue && !item.issueCodes.includes(issue)) return false;
    if (!query) return true;
    const haystack = [
      item.title,
      item.offerId,
      ...item.issueCodes,
      ...(index ? item.issueCodes.map(code => describeIssue(code, index)) : []),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

export function snapshotAgeDays(snapshotDate: string, today = new Date()): number {
  const snap = Date.UTC(Number(snapshotDate.slice(0, 4)), Number(snapshotDate.slice(5, 7)) - 1, Number(snapshotDate.slice(8, 10)));
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((now - snap) / 86_400_000));
}

export const isStale = (snapshotDate: string, today = new Date()) => snapshotAgeDays(snapshotDate, today) > STALE_SNAPSHOT_DAYS;

// Score chip tone: same thresholds the audit reports use for their bands.
export function scoreTone(score: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (score === null) return 'none';
  if (score >= 80) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}
