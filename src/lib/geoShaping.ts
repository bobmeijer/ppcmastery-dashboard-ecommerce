// Pure shaping for the Countries page. Runs on server and client, no React.
import { Derived, derive, emptyTotals, addRow, fmtCurrency, fmtPercent, fmtRatio, groupBy, Totals } from './metrics';
import { displayNetwork, NETWORK_ORDER } from './filters';

export interface GeoRow {
  account_id: string;
  period: string;
  campaign_id: string;
  campaign_name: string;
  status?: string;           // campaign_dim status; '' or missing counts as REMOVED in the filters
  category: string;
  network: string;
  country_code: string;      // NL, BE, DE, LU, FR, GB, Other
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

export type CountryKey = 'NL' | 'BE' | 'Other';
export const COUNTRY_KEYS: CountryKey[] = ['NL', 'BE', 'Other'];

export const COUNTRY_NAMES: Record<string, string> = {
  NL: 'Netherlands', BE: 'Belgium', DE: 'Germany', LU: 'Luxembourg', FR: 'France', GB: 'United Kingdom', Other: 'Other',
};
export const countryName = (code: string) => COUNTRY_NAMES[code] || code;

// Both labels target NL and BE; everything else folds into Other.
export const countryKey = (code: string | null | undefined): CountryKey => (code === 'NL' || code === 'BE' ? code : 'Other');

export type StackMetric = 'conversions_value' | 'cost' | 'conversions' | 'clicks';
export const STACK_METRICS: { key: StackMetric; label: string }[] = [
  { key: 'conversions_value', label: 'Revenue' },
  { key: 'cost', label: 'Cost' },
  { key: 'conversions', label: 'Purchases' },
  { key: 'clicks', label: 'Clicks' },
];

const sum = (rows: GeoRow[]): Derived => derive(rows.reduce<Totals>((acc, r) => addRow(acc, r), emptyTotals()));

export interface CountrySummary extends Derived {
  code: CountryKey;
  share: number | null;            // share of total cost in the period
  previous: (Derived & { share: number | null }) | null;
}

// One summary per NL / BE / Other, with the comparison period alongside.
export function countrySummaries(rows: GeoRow[], compareRows: GeoRow[]): Record<CountryKey, CountrySummary> {
  const total = sum(rows);
  const previousTotal = compareRows.length ? sum(compareRows) : null;
  const out = {} as Record<CountryKey, CountrySummary>;
  for (const code of COUNTRY_KEYS) {
    const current = sum(rows.filter(r => countryKey(r.country_code) === code));
    const prevRows = compareRows.filter(r => countryKey(r.country_code) === code);
    const previous = previousTotal ? sum(prevRows) : null;
    out[code] = {
      code, ...current,
      share: total.cost > 0 ? current.cost / total.cost : null,
      previous: previous && previousTotal ? { ...previous, share: previousTotal.cost > 0 ? previous.cost / previousTotal.cost : null } : null,
    };
  }
  return out;
}

export interface OtherLine { code: string; name: string; cost: number; conversions_value: number; roas: number | null; share: number | null }

// The actual countries behind Other, largest spend first.
export function otherBreakdown(rows: GeoRow[]): OtherLine[] {
  const total = sum(rows).cost;
  const groups = groupBy(rows.filter(r => countryKey(r.country_code) === 'Other'), r => r.country_code || 'Other');
  return [...groups.entries()]
    .map(([code, d]) => ({ code, name: countryName(code), cost: d.cost, conversions_value: d.conversions_value, roas: d.roas, share: total > 0 ? d.cost / total : null }))
    .sort((a, b) => b.cost - a.cost);
}

// A type alias (not an interface) so it passes as TrendChart's Record<string, unknown> rows.
export type GeoChartPoint = {
  period: string;
  NL: number | null; BE: number | null; Other: number | null;
  NL_roas: number | null; BE_roas: number | null; Other_roas: number | null;
};

// Stacked bars = the chosen metric per country; lines = ROAS per country.
export function geoChartData(rows: GeoRow[], metric: StackMetric): GeoChartPoint[] {
  const periods = [...new Set(rows.map(r => r.period))].sort();
  return periods.map(period => {
    const inPeriod = rows.filter(r => r.period === period);
    const point = { period } as GeoChartPoint;
    for (const code of COUNTRY_KEYS) {
      const d = sum(inPeriod.filter(r => countryKey(r.country_code) === code));
      point[code] = d.impressions > 0 || d.cost > 0 ? d[metric] : null;
      point[`${code}_roas`] = d.roas;
    }
    return point;
  });
}

export interface MatrixCells {
  NL: Derived | null; BE: Derived | null; Other: Derived | null;
  total: Derived;
}

export interface MatrixRow extends MatrixCells {
  name: string;
  previous: MatrixCells | null;   // same cells in the comparison period; null without comparison
}

const matrixCells = (rows: GeoRow[]): MatrixCells => {
  const cell = (code: CountryKey) => {
    const d = sum(rows.filter(r => countryKey(r.country_code) === code));
    return d.impressions > 0 || d.cost > 0 ? d : null;
  };
  return { NL: cell('NL'), BE: cell('BE'), Other: cell('Other'), total: sum(rows) };
};

// The network dimension uses the display network (Branded / Non-Branded Search and
// Shopping, PMax counted as Shopping), like the Networks page and the filters.
const dimensionOf = (r: GeoRow, dimension: 'category' | 'network') =>
  (dimension === 'network' ? displayNetwork(r) : r.category) || 'Other';

const networkRank = (name: string) => { const i = NETWORK_ORDER.indexOf(name); return i < 0 ? NETWORK_ORDER.length : i; };

// Rows = category or display network, columns = NL / BE / Other, cell = cost + ROAS.
// Categories sort by total cost, networks in NETWORK_ORDER. With compareRows each
// row carries the same cells for the comparison period.
export function countryMatrix(rows: GeoRow[], dimension: 'category' | 'network', compareRows: GeoRow[] = []): MatrixRow[] {
  const names = [...new Set(rows.map(r => dimensionOf(r, dimension)))];
  const hasCompare = compareRows.length > 0;
  return names.map(name => ({
    name,
    ...matrixCells(rows.filter(r => dimensionOf(r, dimension) === name)),
    previous: hasCompare ? matrixCells(compareRows.filter(r => dimensionOf(r, dimension) === name)) : null,
  })).sort((a, b) => (dimension === 'network' ? networkRank(a.name) - networkRank(b.name) : 0) || b.total.cost - a.total.cost);
}

export const matrixTotals = (rows: GeoRow[], compareRows: GeoRow[] = []): MatrixRow => ({
  name: 'Total', ...matrixCells(rows), previous: compareRows.length ? matrixCells(compareRows) : null,
});

export interface BeVsNlFinding {
  flagged: boolean;
  ratio: number | null;          // BE ROAS / NL ROAS
  threshold: number;
  text: string;                  // a plain finding, no recommendation
}

// Admin-only note: flags when BE ROAS sits below 60% of NL ROAS over the period.
export function beVsNlFinding(nl: CountrySummary, be: CountrySummary, threshold = 0.6): BeVsNlFinding | null {
  if (be.cost <= 0 && nl.cost <= 0) return null;
  if (nl.roas === null || be.roas === null) {
    return {
      flagged: false, ratio: null, threshold,
      text: be.cost <= 0
        ? `No Belgian cost in this period; NL ROAS ${fmtRatio(nl.roas)}.`
        : `BE has ${fmtCurrency(be.cost)} cost and ${fmtCurrency(be.conversions_value)} revenue (ROAS ${fmtRatio(be.roas)}); NL ROAS ${fmtRatio(nl.roas)}. The ratio cannot be calculated.`,
    };
  }
  const ratio = nl.roas > 0 ? be.roas / nl.roas : null;
  const flagged = ratio !== null && ratio < threshold;
  const gap = ratio === null ? null : 1 - ratio;
  const base = `BE ROAS ${fmtRatio(be.roas)} against NL ROAS ${fmtRatio(nl.roas)}`;
  const shareText = `BE = ${fmtPercent(be.share)} of cost (${fmtCurrency(be.cost)})`;
  const text = flagged
    ? `${base}: BE is ${fmtPercent(gap, 0)} below NL, below the threshold of ${fmtPercent(threshold, 0)}. ${shareText}.`
    : `${base}: BE is at ${fmtPercent(ratio, 0)} of NL, above the threshold of ${fmtPercent(threshold, 0)}. ${shareText}.`;
  return { flagged, ratio, threshold, text };
}
