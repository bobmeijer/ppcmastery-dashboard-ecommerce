'use client';

// Shared data shaping and small visual primitives for the overview page.
import { useMemo } from 'react';
import type { CampaignReport, ReportAccount } from '@/hooks/useReport';
import { Derived, FactRow, fmtPercent, formatMetric, groupBy, MetricKey, change, withRevenueShare } from '@/lib/metrics';
import { activeTarget, byPeriod, lagStart, PeriodPoint, samplesTotal, totals } from '@/lib/reportShaping';
import type { TargetRow } from '@/lib/reports';
// Search splits into branded and non-branded on the overview.
import { displayNetwork } from '@/lib/filters';

export interface AccountView {
  account: ReportAccount;
  current: Derived;
  previous: Derived | null;
  periods: PeriodPoint[];
  comparePeriods: PeriodPoint[];
  target: TargetRow | null;
  byCategory: { name: string; cost: number; conversions_value: number; roas: number | null; conversions: number; share: number | null }[];
}

// One row of an overview breakdown table (by network, category,
// campaign). `previous` is the same group in the comparison period, null when
// no comparison is chosen or the group did not exist back then.
export interface BreakdownRow extends Derived {
  id: string;             // group key: display network, category or campaign_id
  name: string;           // label in the first column
  network?: string;       // campaigns only
  share: number | null;   // share of the period's revenue
  previousShare?: number | null;
  previous: Derived | null;
}

export interface OverviewView {
  current: Derived;
  previous: Derived | null;
  periods: PeriodPoint[];
  comparePeriods: PeriodPoint[];
  samples: { count: number; value: number };
  roasTarget: TargetRow | null;
  cpaTarget: TargetRow | null;
  byNetwork: BreakdownRow[];
  byCategory: BreakdownRow[];
  byCampaign: BreakdownRow[];
  byAccount: AccountView[];
  lagFrom: string | null;
  grain: 'day' | 'week' | 'month';
  compareLabel: string;
  freshest: string | null;
}

// Groups the current and the comparison rows on the same key so every row
// carries its own previous-period totals. Groups only present in the
// comparison period are dropped: the table shows the current period.
function rowsOf(rows: FactRow[], compareRows: FactRow[], key: (r: FactRow) => string, totalCost: number,
  meta?: (r: FactRow) => { name: string; network?: string }): BreakdownRow[] {
  const groups = groupBy(rows, key);
  const previous = groupBy(compareRows, key);
  const labels = new Map<string, { name: string; network?: string }>();
  if (meta) for (const r of rows) { const k = key(r); if (!labels.has(k)) labels.set(k, meta(r)); }
  void totalCost;   // kept in the signature; the share is revenue-based now
  return withRevenueShare([...groups.entries()].map(([id, d]) => ({
    id, name: labels.get(id)?.name ?? id, network: labels.get(id)?.network, ...d,
    share: null as number | null,
    previous: previous.get(id) ?? null,
  }))).sort((a, b) => b.cost - a.cost);
}

export function useOverviewView(data: CampaignReport | null, rangeEnd: string, lagDays: number, includeLag: boolean, compare: string): OverviewView | null {
  return useMemo(() => {
    if (!data) return null;
    const current = totals(data.rows);
    const previous = data.compareRows.length ? totals(data.compareRows) : null;
    const periods = byPeriod(data.rows);
    const comparePeriods = byPeriod(data.compareRows);
    const single = data.accounts.length === 1 ? data.accounts[0].id : null;
    const campaignIds = new Set(data.rows.map(r => r.campaign_id));
    const byAccount: AccountView[] = data.accounts.map(account => {
      const rows = data.rows.filter(r => r.account_id === account.id);
      const compareRows = data.compareRows.filter(r => r.account_id === account.id);
      const cur = totals(rows);
      return {
        account, current: cur, previous: compareRows.length ? totals(compareRows) : null,
        periods: byPeriod(rows), comparePeriods: byPeriod(compareRows),
        target: activeTarget(data.targets, account.id, 'roas', rangeEnd),
        byCategory: rowsOf(rows, compareRows, r => r.category, cur.cost),
      };
    });
    return {
      current, previous, periods, comparePeriods,
      // Roles of the campaigns that passed the top-bar filters only.
      samples: samplesTotal(data.roles.filter(r => campaignIds.has(r.campaign_id))),
      roasTarget: single ? activeTarget(data.targets, single, 'roas', rangeEnd) : null,
      cpaTarget: single ? activeTarget(data.targets, single, 'cpa', rangeEnd) : null,
      byNetwork: rowsOf(data.rows, data.compareRows, displayNetwork, current.cost),
      byCategory: rowsOf(data.rows, data.compareRows, r => r.category, current.cost),
      byCampaign: rowsOf(data.rows, data.compareRows, r => r.campaign_id, current.cost, r => ({ name: r.campaign_name, network: r.network })),
      byAccount,
      lagFrom: includeLag ? lagStart(periods.map(p => p.period), lagDays, data.grain) : null,
      grain: data.grain,
      compareLabel: compare === 'year' ? 'vs last year' : compare === 'none' ? '' : 'vs previous period',
      freshest: Object.values(data.freshness).filter(Boolean).sort().pop() || null,
    };
  }, [data, rangeEnd, lagDays, includeLag, compare]);
}

// Inline SVG sparkline: no axes, one line, optional compare line.
export function Spark({ values, compare, width = 160, height = 40, color = 'var(--ink)', fill = true }: {
  values: (number | null)[]; compare?: (number | null)[]; width?: number; height?: number; color?: string; fill?: boolean;
}) {
  const all = [...values, ...(compare || [])].filter((v): v is number => v !== null && Number.isFinite(v));
  if (all.length === 0) return <svg width={width} height={height} />;
  const min = Math.min(0, ...all);
  const max = Math.max(...all) || 1;
  const path = (vals: (number | null)[]) => vals.map((v, i) => {
    if (v === null) return null;
    const x = (i / Math.max(1, vals.length - 1)) * width;
    const y = height - ((v - min) / (max - min || 1)) * (height - 4) - 2;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(' ');
  const main = path(values);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {fill && main && <path d={`${main} L${width},${height} L0,${height} Z`} fill={color} opacity={0.08} />}
      {compare && <path d={path(compare)} fill="none" stroke="var(--gray-400)" strokeWidth={1.2} strokeDasharray="3 3" />}
      {main && <path d={main} fill="none" stroke={color} strokeWidth={1.8} />}
    </svg>
  );
}

export function Delta({ metric, current, previous, suffix }: { metric: MetricKey; current: number | null; previous: number | null | undefined; suffix?: string }) {
  if (previous === undefined) return null;
  const d = change(current, previous ?? null);
  if (d === null) return <span className="text-xs text-subtle">no comparison</span>;
  const higherIsBetter = !['cost', 'cpa', 'cpc', 'budget_lost_is', 'rank_lost_is'].includes(metric);
  const good = higherIsBetter ? d >= 0 : d <= 0;
  return <span className="num text-xs" style={{ color: good ? 'var(--good)' : 'var(--bad)' }}>{d >= 0 ? '+' : ''}{fmtPercent(d)}{suffix ? ` ${suffix}` : ''}</span>;
}

export const big = (metric: MetricKey, value: number | null) => formatMetric(metric, value);

// twelve tiles, six per row, in this order.
export const KPI_SET: MetricKey[] = ['impressions', 'clicks', 'ctr', 'cpc', 'cost', 'conversions', 'cpa', 'conversions_value', 'roas', 'aov', 'budget_lost_is', 'rank_lost_is'];
