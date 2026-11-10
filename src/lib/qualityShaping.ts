// Pure shaping for the Quality Score page. Input: one row
// per keyword per day with that day's Quality Score and its three components
// (read_keyword_quality_json). Output: impression-weighted Quality Score,
// the share of impressions per component bucket, trend, distribution and
// tables per campaign, ad group and keyword. Runs on the server; tested in
// qualityShaping.test.ts.
//
// Components follow Google's buckets: 2 below average, 3 average, 4 above
// average. Weighting is by impressions: that is how often a score mattered.
import { daysBetween, safeDiv } from './metrics';
import { applyFilters, FilterState } from './filters';

// [date, campaign_id, campaign_name, campaign_status, network, category, ad_group_id, ad_group_name, criterion_id, keyword_text, match_type,
//  impressions, clicks, cost, conversions, conversions_value, quality_score, expected_ctr, ad_relevance, landing_page]
export type QualityTuple = [string, string, string, string, string, string, string, string, string, string, string | null,
  number | string, number | string, number | string, number | string, number | string, number | null, number | null, number | null, number | null];

export interface QualityRow {
  date: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  network: string;
  category: string;
  ad_group_id: string;
  ad_group_name: string;
  criterion_id: string;
  keyword: string;
  match_type: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  qs: number | null;
  expected_ctr: number | null;
  ad_relevance: number | null;
  landing_page: number | null;
}

export const COMPONENTS = ['expected_ctr', 'ad_relevance', 'landing_page'] as const;
export type Component = (typeof COMPONENTS)[number];
// Short names, used everywhere on the page. "<name> below" = below average.
export const COMPONENT_NAMES: Record<Component, string> = {
  expected_ctr: 'Expected CTR',
  ad_relevance: 'Relevance',
  landing_page: 'Landing page',
};
export const belowLabel = (c: Component) => `${COMPONENT_NAMES[c]} below`;

export const toRow = (t: QualityTuple): QualityRow => ({
  date: String(t[0]).slice(0, 10), campaign_id: t[1], campaign_name: t[2], status: t[3], network: t[4], category: t[5],
  ad_group_id: t[6], ad_group_name: t[7], criterion_id: t[8], keyword: t[9], match_type: t[10],
  impressions: Number(t[11] || 0), clicks: Number(t[12] || 0), cost: Number(t[13] || 0), conversions: Number(t[14] || 0), conversions_value: Number(t[15] || 0),
  qs: t[16] === null ? null : Number(t[16]), expected_ctr: t[17] === null ? null : Number(t[17]), ad_relevance: t[18] === null ? null : Number(t[18]), landing_page: t[19] === null ? null : Number(t[19]),
});

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

export interface ComponentShares { below: number | null; average: number | null; above: number | null }

export interface QualityStats {
  impressions: number;         // all impressions in the rows
  scored: number;              // impressions on rows with a Quality Score
  weightedQs: number | null;   // impression-weighted Quality Score, 1 decimal
  lowShare: number | null;     // share of scored impressions at QS 5 or lower
  lowCost: number;             // cost on rows at QS 5 or lower
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number | null;
  cpc: number | null;
  components: Record<Component, ComponentShares>;
}

export function stats(rows: QualityRow[]): QualityStats {
  let impressions = 0, scored = 0, qsSum = 0, low = 0, lowCost = 0, clicks = 0, cost = 0, conversions = 0, value = 0;
  const comp: Record<Component, { below: number; average: number; above: number; total: number }> = {
    expected_ctr: { below: 0, average: 0, above: 0, total: 0 },
    ad_relevance: { below: 0, average: 0, above: 0, total: 0 },
    landing_page: { below: 0, average: 0, above: 0, total: 0 },
  };
  for (const r of rows) {
    impressions += r.impressions; clicks += r.clicks; cost += r.cost; conversions += r.conversions; value += r.conversions_value;
    if (r.qs !== null) {
      scored += r.impressions;
      qsSum += r.qs * r.impressions;
      if (r.qs <= 5) { low += r.impressions; lowCost += r.cost; }
    }
    for (const c of COMPONENTS) {
      const b = r[c];
      if (b === null) continue;
      comp[c].total += r.impressions;
      if (b === 2) comp[c].below += r.impressions; else if (b === 3) comp[c].average += r.impressions; else if (b === 4) comp[c].above += r.impressions;
    }
  }
  const shares = (c: Component): ComponentShares => ({
    below: r4(safeDiv(comp[c].below, comp[c].total)), average: r4(safeDiv(comp[c].average, comp[c].total)), above: r4(safeDiv(comp[c].above, comp[c].total)),
  });
  return {
    impressions, scored, weightedQs: r1(safeDiv(qsSum, scored)), lowShare: r4(safeDiv(low, scored)), lowCost: r2(lowCost),
    clicks, cost: r2(cost), conversions: r2(conversions), conversions_value: r2(value), ctr: r4(safeDiv(clicks, impressions)), cpc: safeDiv(cost, clicks),
    components: { expected_ctr: shares('expected_ctr'), ad_relevance: shares('ad_relevance'), landing_page: shares('landing_page') },
  };
}

// Append in place: copying the list per row is quadratic on a year of keyword-days.
const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
};

const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export interface QualityPoint { period: string; qs: number | null; expected_ctr: number | null; ad_relevance: number | null; landing_page: number | null; low: number | null }

export function trend(rows: QualityRow[], grain: 'day' | 'week'): QualityPoint[] {
  const groups = new Map<string, QualityRow[]>();
  for (const r of rows) {
    const key = grain === 'week' ? mondayOf(r.date) : r.date;
    push(groups, key, r);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, list]) => {
    const s = stats(list);
    return { period, qs: s.weightedQs, expected_ctr: s.components.expected_ctr.below, ad_relevance: s.components.ad_relevance.below, landing_page: s.components.landing_page.below, low: s.lowShare };
  });
}

export interface DistributionBar { qs: number; impressions: number; share: number | null; cost: number; keywords: number }

export function distribution(rows: QualityRow[]): DistributionBar[] {
  const scored = rows.filter(r => r.qs !== null);
  const total = scored.reduce((a, r) => a + r.impressions, 0);
  return Array.from({ length: 10 }, (_, i) => i + 1).map(qs => {
    const list = scored.filter(r => r.qs === qs);
    const impressions = list.reduce((a, r) => a + r.impressions, 0);
    return { qs, impressions, share: r4(safeDiv(impressions, total)), cost: r2(list.reduce((a, r) => a + r.cost, 0)), keywords: new Set(list.map(r => `${r.ad_group_id}|${r.criterion_id}`)).size };
  });
}

export interface GroupStats extends QualityStats { key: string; name: string; campaign: string; keywords: number }

function groupBy(rows: QualityRow[], keyOf: (r: QualityRow) => string, nameOf: (r: QualityRow) => string, campaignOf: (r: QualityRow) => string): GroupStats[] {
  const groups = new Map<string, QualityRow[]>();
  for (const r of rows) push(groups, keyOf(r), r);
  return [...groups.entries()].map(([key, list]) => ({
    key, name: nameOf(list[0]), campaign: campaignOf(list[0]),
    keywords: new Set(list.map(r => `${r.ad_group_id}|${r.criterion_id}`)).size,
    ...stats(list),
  })).sort((a, b) => b.cost - a.cost || b.impressions - a.impressions);
}

export interface KeywordStats extends QualityStats {
  key: string;
  keyword: string;
  match_type: string | null;
  campaign: string;
  ad_group: string;
  latest: { date: string; qs: number | null; expected_ctr: number | null; ad_relevance: number | null; landing_page: number | null } | null;
}

// Per keyword: the period totals plus the latest day with a score (what the keyword looks like now).
export function keywords(rows: QualityRow[]): KeywordStats[] {
  const groups = new Map<string, QualityRow[]>();
  for (const r of rows) {
    push(groups, `${r.ad_group_id}|${r.criterion_id}`, r);
  }
  return [...groups.entries()].map(([key, list]) => {
    const scoredDays = list.filter(r => r.qs !== null).sort((a, b) => a.date.localeCompare(b.date));
    const last = scoredDays[scoredDays.length - 1];
    return {
      key, keyword: list[0].keyword, match_type: list[0].match_type, campaign: list[0].campaign_name, ad_group: list[0].ad_group_name,
      latest: last ? { date: last.date, qs: last.qs, expected_ctr: last.expected_ctr, ad_relevance: last.ad_relevance, landing_page: last.landing_page } : null,
      ...stats(list),
    };
  }).sort((a, b) => b.cost - a.cost || b.impressions - a.impressions);
}

// Fix list: where to start. Quality Score is not repaired per
// keyword but where the cause sits: expected CTR and ad relevance in the ads of
// an ad group, landing page experience on the page (per URL once the sync reads
// final URLs; until then per ad group as well). One line per ad group and
// component, with what is at stake: the cost, impressions and value on the
// keyword-days where that component was below average. Sorted by cost: money
// behind a fixable cause, no modelled CPC saving (those tables are industry
// folklore, not Google's). Small groups stay out (minImpressions).
export interface FixItem {
  key: string;
  component: Component;
  adGroupId: string;
  adGroup: string;
  campaign: string;
  keywords: number;           // keywords with this component below average on at least one day
  impressions: number;        // at stake
  cost: number;
  conversions_value: number;
  share: number | null;       // at-stake impressions / the ad group's impressions with a rating for this component
}

export function fixList(rows: QualityRow[], minImpressions = 100): FixItem[] {
  const groups = new Map<string, { item: FixItem; kw: Set<string> }>();
  const rated = new Map<string, number>();
  for (const r of rows) {
    for (const c of COMPONENTS) {
      const b = r[c];
      if (b === null) continue;
      const key = `${r.ad_group_id}|${c}`;
      rated.set(key, (rated.get(key) || 0) + r.impressions);
      if (b !== 2) continue;
      let g = groups.get(key);
      if (!g) {
        g = { item: { key, component: c, adGroupId: r.ad_group_id, adGroup: r.ad_group_name || r.ad_group_id, campaign: r.campaign_name, keywords: 0, impressions: 0, cost: 0, conversions_value: 0, share: null }, kw: new Set() };
        groups.set(key, g);
      }
      g.item.impressions += r.impressions;
      g.item.cost += r.cost;
      g.item.conversions_value += r.conversions_value;
      g.kw.add(r.criterion_id);
    }
  }
  return [...groups.values()]
    .map(({ item, kw }) => ({ ...item, keywords: kw.size, cost: r2(item.cost), conversions_value: r2(item.conversions_value), share: r4(safeDiv(item.impressions, rated.get(item.key) || 0)) }))
    .filter(f => f.impressions >= minImpressions)
    .sort((a, b) => b.cost - a.cost || b.impressions - a.impressions);
}

// The binding component: the one with the largest share of impressions below average.
export function bindingComponent(s: QualityStats): Component | null {
  const ranked = COMPONENTS.map(c => ({ c, below: s.components[c].below })).filter(x => x.below !== null && x.below > 0).sort((a, b) => (b.below as number) - (a.below as number));
  return ranked.length ? ranked[0].c : null;
}

export interface QualityReport {
  grain: 'day' | 'week';
  current: QualityStats;
  previous: QualityStats | null;
  trend: QualityPoint[];
  distribution: DistributionBar[];
  campaigns: GroupStats[];
  adGroups: GroupStats[];
  keywords: KeywordStats[];
  fixes: FixItem[];
}

export function buildQualityReport(input: { rows: QualityRow[]; compareRows: QualityRow[] | null; start: string; end: string; filters: FilterState }): QualityReport {
  // applyFilters expects campaign rows: campaign_id, campaign_name, network, category, status.
  const current = applyFilters(input.rows, input.filters);
  const previous = input.compareRows ? applyFilters(input.compareRows, input.filters) : null;
  const grain: 'day' | 'week' = daysBetween(input.start, input.end) > 62 ? 'week' : 'day';
  return {
    grain,
    current: stats(current),
    previous: previous && previous.length ? stats(previous) : null,
    trend: trend(current, grain),
    distribution: distribution(current),
    campaigns: groupBy(current, r => r.campaign_id, r => r.campaign_name, r => r.campaign_name),
    adGroups: groupBy(current, r => r.ad_group_id, r => r.ad_group_name || r.ad_group_id, r => r.campaign_name),
    keywords: keywords(current),
    fixes: fixList(current),
  };
}
