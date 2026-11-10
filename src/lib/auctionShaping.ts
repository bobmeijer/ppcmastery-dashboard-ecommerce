// Pure shaping for the Auction insights page. Runs on client and server, no React.
// Rows come aggregated from read_auction_insights_json (migration 0012): one
// row per period x competitor for the chosen network and category.
import type { AuctionNetwork } from '@/lib/auctionParse';
import { daysBetween, fmtPercent } from '@/lib/metrics';

export type { AuctionNetwork };
export type AuctionGrain = 'day' | 'week' | 'month';

export const NETWORKS: AuctionNetwork[] = ['Search', 'Shopping'];
export const OWN = 'You';                       // how Google labels the account itself

export interface AuctionRow {
  period: string;                               // ISO day, Monday or first of the month; range start for totals
  network: AuctionNetwork;
  category: string;
  competitor: string;                           // domain (Search), store name (Shopping) or "You"
  impression_share: number | null;
  is_capped: boolean;                           // most of the weight was Google's "< 10%"
  overlap_rate: number | null;
  position_above_rate: number | null;
  top_of_page_rate: number | null;
  abs_top_rate: number | null;
  outranking_share: number | null;
  eligible: number;                             // weight: own impressions / own auction share
  campaign_days: number;
}

// Categorical palette validated with the dataviz skill (8 slots, white surface).
// Colors follow the competitor, never its rank in the current filter.
export const COMPETITOR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const OWN_COLOR = 'var(--series-1)';

// Default grain for a period.
export const defaultGrain = (start: string, end: string): AuctionGrain => {
  const days = daysBetween(start, end);
  return days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
};

// Watch-list match across Search domains and Shopping store names: "Acme & Co"
// and "acmeenco.nl" are the same competitor. Lowercase, "&" -> "en", drop the
// TLD, legal suffixes and everything that is not a letter or digit.
export function watchKey(name: string): string {
  return name.toLowerCase()
    .replace(/&/g, 'en')
    .replace(/\b(b\.?v\.?|n\.?v\.?|gmbh|bvba)\b/g, '')
    .replace(/^(www\.|nl\.)/, '')
    .replace(/\.(nl|be|com|de|eu|shop|nu|net|org)$/g, '')
    .replace(/[^a-z0-9]/g, '');
}
export const onWatchlist = (name: string, watchlist: string[]) => {
  const key = watchKey(name);
  return key.length > 0 && watchlist.some(w => watchKey(w) === key);
};

const num = (v: number | null) => (v === null ? -1 : v);

// Competitors strongest overlap first (ties: impression share). Own row excluded.
export function rankCompetitors(rows: AuctionRow[]): AuctionRow[] {
  return rows.filter(r => r.competitor !== OWN)
    .sort((a, b) => num(b.overlap_rate) - num(a.overlap_rate) || num(b.impression_share) - num(a.impression_share) || a.competitor.localeCompare(b.competitor));
}

// Top N competitors by overlap over the whole period; the watch list narrows the candidates first.
export function topCompetitors(totals: AuctionRow[], n = 8, watchlist?: string[] | null): string[] {
  const ranked = rankCompetitors(totals).map(r => r.competitor);
  return (watchlist ? ranked.filter(c => onWatchlist(c, watchlist)) : ranked).slice(0, n);
}

// Stable color per competitor: the unfiltered top 8 keep their slot; anything else takes a free slot.
export function assignColors(displayed: string[], baseRanking: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set<number>();
  baseRanking.slice(0, COMPETITOR_COLORS.length).forEach((d, i) => { if (displayed.includes(d)) { out[d] = COMPETITOR_COLORS[i]; taken.add(i); } });
  for (const d of displayed) {
    if (out[d]) continue;
    const slot = COMPETITOR_COLORS.findIndex((_, i) => !taken.has(i));
    const index = slot === -1 ? Object.keys(out).length % COMPETITOR_COLORS.length : slot;
    taken.add(index);
    out[d] = COMPETITOR_COLORS[index];
  }
  return out;
}

// Metrics the trend chart can show. Shopping auction insights have no position metrics.
export type AuctionMetric = 'impression_share' | 'overlap_rate' | 'position_above_rate' | 'top_of_page_rate' | 'abs_top_rate' | 'outranking_share';
export const AUCTION_METRICS: { key: AuctionMetric; label: string; title: string; searchOnly: boolean }[] = [
  { key: 'impression_share', label: 'IS', title: 'Impression share', searchOnly: false },
  { key: 'overlap_rate', label: 'Overlap', title: 'Overlap', searchOnly: false },
  { key: 'position_above_rate', label: 'Position above', title: 'Position above', searchOnly: true },
  { key: 'top_of_page_rate', label: 'Top of page', title: 'Top of page rate', searchOnly: true },
  { key: 'abs_top_rate', label: 'Abs. top', title: 'Abs. top of page rate', searchOnly: true },
  { key: 'outranking_share', label: 'Outranking', title: 'Outranking share', searchOnly: false },
];
export const metricsFor = (network: AuctionNetwork) => AUCTION_METRICS.filter(m => network === 'Search' || !m.searchOnly);

export interface TrendPoint { period: string; [competitor: string]: number | string | null }

// One point per period with the chosen metric per competitor (own = "You").
// A competitor missing in a period is null: Google left it out (below its threshold).
export function trendPoints(rows: AuctionRow[], competitors: string[], metric: AuctionMetric = 'impression_share'): TrendPoint[] {
  const byPeriod = new Map<string, Map<string, number | null>>();
  for (const r of rows) {
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, new Map());
    if (competitors.includes(r.competitor)) byPeriod.get(r.period)!.set(r.competitor, r[metric]);
  }
  return [...byPeriod.keys()].sort().map(period => {
    const point: TrendPoint = { period };
    for (const c of competitors) point[c] = byPeriod.get(period)?.get(c) ?? null;
    return point;
  });
}

export interface NewPlayer { competitor: string; impression_share: number | null; is_capped: boolean; overlap_rate: number | null }

// Competitors in this period that did not appear at all in the comparison period.
export function newPlayers(totals: AuctionRow[], compareTotals: AuctionRow[] | null): NewPlayer[] {
  if (!compareTotals || compareTotals.length === 0) return [];
  const before = new Set(compareTotals.map(r => r.competitor));
  return rankCompetitors(totals).filter(r => !before.has(r.competitor)).map(r => ({
    competitor: r.competitor, impression_share: r.impression_share, is_capped: r.is_capped, overlap_rate: r.overlap_rate,
  }));
}

// Google prints small shares as "< 10%"; keep that in the table instead of a fake 10,0%.
export const fmtShare = (value: number | null, capped?: boolean) => (capped ? '< 10%' : fmtPercent(value, 1));
