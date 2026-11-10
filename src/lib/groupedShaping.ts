// Pure shaping for the Networks, Campaigns and Categories pages: campaign
// facts grouped by any key, with the comparison period kept per row so the
// table can show previous values and deltas, plus one trend line per group.
// No profit, margin or POAS anywhere.
import { LOCALE } from '@/lib/config';
import { addRow, derive, Derived, emptyTotals, FactRow, groupBy, MetricKey, Totals, withRevenueShare } from './metrics';
import { displayNetwork, NETWORK_ORDER } from './filters';

export interface GroupRow extends Derived {
  name: string;
  share: number | null;        // share of revenue among the rows that were grouped
  previousShare?: number | null;
  previous: Derived | null;    // same group in the comparison period
}

export interface CampaignGroupRow extends GroupRow {
  campaign_id: string;
  network: string;             // display network (Branded Search / Non-Branded Search / ...)
  category: string;
  status: string;              // '' when the dimension row is missing (counts as removed)
}

const withShare = <T extends { cost: number; conversions_value: number; previous: Derived | null }>(rows: T[]): T[] =>
  withRevenueShare(rows).sort((a, b) => b.cost - a.cost);

// One row per group present in the current period, sorted by cost. Groups that
// only exist in the comparison period are not listed (same as the overview).
export function groupRows(rows: FactRow[], compareRows: FactRow[], keyOf: (row: FactRow) => string): GroupRow[] {
  const current = groupBy(rows, keyOf);
  const previous = groupBy(compareRows, keyOf);
  return withShare([...current.entries()].map(([name, d]) => ({ name, ...d, share: null, previous: previous.get(name) || null })));
}

const latestByCampaign = (rows: FactRow[]) => {
  const latest = new Map<string, FactRow>();
  for (const row of rows) {
    const current = latest.get(row.campaign_id);
    if (!current || row.period > current.period) latest.set(row.campaign_id, row);
  }
  return latest;
};

// One row per campaign with its display network and today's status.
export function campaignRows(rows: FactRow[], compareRows: FactRow[]): CampaignGroupRow[] {
  const current = groupBy(rows, r => r.campaign_id);
  const previous = groupBy(compareRows, r => r.campaign_id);
  const latest = latestByCampaign(rows);
  return withShare([...current.entries()].map(([id, d]) => {
    const meta = latest.get(id)!;
    return {
      campaign_id: id, name: meta.campaign_name, network: displayNetwork(meta), category: meta.category, status: meta.status || '',
      ...d, share: null, previous: previous.get(id) || null,
    };
  }));
}

// Totals of a set of rows as a table row (footer or the account line).
export function totalRow(rows: FactRow[], compareRows: FactRow[], name = 'Total'): GroupRow {
  const current = derive(rows.reduce<Totals>((acc, r) => addRow(acc, r), emptyTotals()));
  const previous = compareRows.length ? derive(compareRows.reduce<Totals>((acc, r) => addRow(acc, r), emptyTotals())) : null;
  return { name, ...current, share: rows.length ? 1 : null, previousShare: previous ? 1 : null, previous };
}

// Display networks in the fixed order Admin asked for; unknown ones at the end.
export const networkRank = (network: string) => {
  const index = NETWORK_ORDER.indexOf(network);
  return index === -1 ? NETWORK_ORDER.length : index;
};

export const sortNetworks = (networks: string[]) =>
  [...networks].sort((a, b) => networkRank(a) - networkRank(b) || a.localeCompare(b, LOCALE));

// A point: the period plus one value per group name.
export type GroupTrendPoint = Record<string, number | string | null> & { period: string };

export interface GroupTrend {
  names: string[];                                        // top N groups by cost, in cost order
  points: GroupTrendPoint[];
}

// One line per group for one metric: the top `maxLines` groups by cost over the
// whole range, every period of the range as a point (null where the group has
// no rows, or the ratio is undefined). Ratios are derived per period from the
// group's totals, never averaged.
export function groupTrend(rows: FactRow[], keyOf: (row: FactRow) => string, metric: MetricKey, maxLines = 6): GroupTrend {
  const costByName = new Map<string, number>();
  for (const row of rows) {
    const name = keyOf(row);
    costByName.set(name, (costByName.get(name) || 0) + Number(row.cost || 0));
  }
  const names = [...costByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxLines).map(([name]) => name);
  const kept = new Set(names);

  const periods = new Map<string, Map<string, Totals>>();
  for (const row of rows) {
    const name = keyOf(row);
    const bucket = periods.get(row.period) || new Map<string, Totals>();
    if (kept.has(name)) bucket.set(name, addRow(bucket.get(name) || emptyTotals(), row));
    periods.set(row.period, bucket);
  }
  const points = [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, bucket]) => {
    const point: GroupTrendPoint = { period };
    for (const name of names) {
      const totals = bucket.get(name);
      point[name] = totals ? derive(totals)[metric] : null;
    }
    return point;
  });
  return { names, points };
}
