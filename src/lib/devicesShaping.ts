// Pure shaping for the Devices page. Client-safe, no React, no Supabase.
// Google's five device values fold into four buckets: MOBILE, DESKTOP, TABLET
// stay as they are; OTHER and CONNECTED_TV become "Other".
import { Derived, derive, emptyTotals, fmtPercent, fmtRatio, groupBy, safeDiv, sumRows } from './metrics';
import { displayNetwork, NETWORK_ORDER } from './filters';

export type DeviceKey = 'mobile' | 'desktop' | 'tablet' | 'other';

export interface DeviceDefinition { key: DeviceKey; label: string; color: string }

export const DEVICES: DeviceDefinition[] = [
  { key: 'mobile', label: 'Mobile', color: 'var(--series-1)' },
  { key: 'desktop', label: 'Desktop', color: 'var(--series-2)' },
  { key: 'tablet', label: 'Tablet', color: 'var(--series-4)' },
  { key: 'other', label: 'Other', color: 'var(--gray-300)' },
];

export interface DeviceFactRow {
  account_id: string;
  period: string;
  campaign_id: string;
  campaign_name: string;
  status?: string;           // campaign_dim status; '' or missing counts as REMOVED in the filters
  category: string;
  network: string;
  device: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

export function deviceKey(device: string | null | undefined): DeviceKey {
  switch (String(device || '').toUpperCase()) {
    case 'MOBILE': return 'mobile';
    case 'DESKTOP': return 'desktop';
    case 'TABLET': return 'tablet';
    default: return 'other';
  }
}

const SEP = '\u001f';
const empty = () => derive(emptyTotals());

// Devices that carried cost in the period, in canonical order. Drives the chart
// series and the matrix columns so an idle bucket does not take space. Cost, not
// impressions: Google reports OTHER rows with impressions and zero spend.
export function activeDevices(rows: DeviceFactRow[]): DeviceDefinition[] {
  const groups = groupBy(rows, r => deviceKey(r.device));
  return DEVICES.filter(d => (groups.get(d.key)?.cost ?? 0) > 0);
}

// --- tiles ---------------------------------------------------------------------

export interface DeviceTile {
  key: DeviceKey;
  label: string;
  current: Derived;
  previous: Derived | null;       // null when there is no comparison period
  share: number | null;           // share of cost in the current period
  previousShare: number | null;
}

// Mobile, Desktop and Tablet are always shown; Other only when it carried cost.
export function deviceTiles(rows: DeviceFactRow[], compareRows: DeviceFactRow[]): DeviceTile[] {
  const current = groupBy(rows, r => deviceKey(r.device));
  const previous = groupBy(compareRows, r => deviceKey(r.device));
  const totalCost = sumRows(rows).cost;
  const previousCost = sumRows(compareRows).cost;
  const hasCompare = compareRows.length > 0;
  return DEVICES.map(d => {
    const cur = current.get(d.key) || empty();
    const prev = hasCompare ? previous.get(d.key) || empty() : null;
    return {
      key: d.key, label: d.label, current: cur, previous: prev,
      share: safeDiv(cur.cost, totalCost),
      previousShare: prev ? safeDiv(prev.cost, previousCost) : null,
    };
  }).filter(t => t.key !== 'other' || t.current.cost > 0 || (t.previous?.cost ?? 0) > 0);
}

// --- period series ---------------------------------------------------------------

export type DevicePoint = { period: string } & Record<DeviceKey, number | null>;

const periodsOf = (rows: DeviceFactRow[]) => [...new Set(rows.map(r => r.period))].sort();

// Cost share per device per period as fractions of that period's total cost
// (a plain stack of these is a 100% stacked chart). All null when nothing was spent.
export function shareByPeriod(rows: DeviceFactRow[]): DevicePoint[] {
  const groups = groupBy(rows, r => `${r.period}${SEP}${deviceKey(r.device)}`);
  return periodsOf(rows).map(period => {
    const costs = DEVICES.map(d => groups.get(`${period}${SEP}${d.key}`)?.cost ?? 0);
    const total = costs.reduce((a, b) => a + b, 0);
    const point = { period } as DevicePoint;
    DEVICES.forEach((d, i) => { point[d.key] = total > 0 ? costs[i] / total : null; });
    return point;
  });
}

export function roasByPeriod(rows: DeviceFactRow[]): DevicePoint[] {
  const groups = groupBy(rows, r => `${r.period}${SEP}${deviceKey(r.device)}`);
  return periodsOf(rows).map(period => {
    const point = { period } as DevicePoint;
    for (const d of DEVICES) point[d.key] = groups.get(`${period}${SEP}${d.key}`)?.roas ?? null;
    return point;
  });
}

// --- device x dimension matrix -----------------------------------------------------

export interface MatrixCell {
  cost: number; clicks: number; conversions: number; conversions_value: number;
  roas: number | null; cvr: number | null;
}

export interface MatrixCells {
  cost: number;                                   // row total, used for sorting
  cells: Partial<Record<DeviceKey, MatrixCell>>;  // missing = no traffic for that device
}

export interface MatrixRow extends MatrixCells {
  name: string;
  previous: MatrixCells | null;                   // same cells in the comparison period; null without comparison
}

const toCell = (d: Derived): MatrixCell => ({
  cost: d.cost, clicks: d.clicks, conversions: d.conversions, conversions_value: d.conversions_value, roas: d.roas, cvr: d.cvr,
});

const matrixCells = (rows: DeviceFactRow[]): MatrixCells => {
  const groups = groupBy(rows, r => deviceKey(r.device));
  const cells: Partial<Record<DeviceKey, MatrixCell>> = {};
  for (const d of DEVICES) { const g = groups.get(d.key); if (g) cells[d.key] = toCell(g); }
  return { cost: sumRows(rows).cost, cells };
};

// The network dimension uses the display network (Branded / Non-Branded Search and
// Shopping, PMax counted as Shopping), like the Networks page and the filters.
const dimensionOf = (r: DeviceFactRow, dimension: 'category' | 'network') =>
  (dimension === 'network' ? displayNetwork(r) : r.category) || 'Other';

const networkRank = (name: string) => { const i = NETWORK_ORDER.indexOf(name); return i < 0 ? NETWORK_ORDER.length : i; };

// Categories sort by row cost, networks in NETWORK_ORDER. With compareRows each
// row carries the same cells for the comparison period.
export function deviceMatrix(rows: DeviceFactRow[], dimension: 'category' | 'network', compareRows: DeviceFactRow[] = []): MatrixRow[] {
  const names = [...new Set(rows.map(r => dimensionOf(r, dimension)))];
  const hasCompare = compareRows.length > 0;
  return names.map(name => ({
    name,
    ...matrixCells(rows.filter(r => dimensionOf(r, dimension) === name)),
    previous: hasCompare ? matrixCells(compareRows.filter(r => dimensionOf(r, dimension) === name)) : null,
  })).sort((a, b) => (dimension === 'network' ? networkRank(a.name) - networkRank(b.name) : 0) || b.cost - a.cost);
}

export function matrixTotal(rows: DeviceFactRow[], compareRows: DeviceFactRow[] = []): MatrixRow {
  return { name: 'Total', ...matrixCells(rows), previous: compareRows.length ? matrixCells(compareRows) : null };
}

// --- finding ---------------------------------------------------------------------

export interface DeviceFinding {
  mobileRoas: number;
  desktopRoas: number;
  mobileShare: number | null;
  desktopShare: number | null;
  text: string;
}

// Plain, factual, no recommendation. Fires when mobile ROAS is below half
// of desktop ROAS in the period. Admin only: the devices route computes it
// and never sends it to the client role.
export function mobileDesktopFinding(tiles: DeviceTile[]): DeviceFinding | null {
  const mobile = tiles.find(t => t.key === 'mobile');
  const desktop = tiles.find(t => t.key === 'desktop');
  if (!mobile || !desktop) return null;
  const m = mobile.current.roas;
  const d = desktop.current.roas;
  if (m === null || d === null || d <= 0) return null;
  if (m >= d / 2) return null;
  const text = `Mobile has a ROAS of ${fmtRatio(m)} in this period on ${fmtPercent(mobile.share, 0)} of the cost. `
    + `Desktop has ${fmtRatio(d)} on ${fmtPercent(desktop.share, 0)} of the cost. `
    + 'That puts mobile ROAS below half of desktop ROAS.';
  return { mobileRoas: m, desktopRoas: d, mobileShare: mobile.share, desktopShare: desktop.share, text };
}
