'use client';

// One column set for every grouped table (Networks, Campaigns, Categories):
// name, then the KPI-tile metrics in tile order with Revenue share next to Revenue,
// then IS. The quieter ones start hidden, like the overview tables. Every
// metric column carries its comparison so the table's "Compare" toggle can
// show the previous value and the delta under the number.
import type { ReactNode } from 'react';
import type { Column } from '@/components/DataTable';
import { Derived, fmtPercent, formatMetric, formatMetricDelta, metricDefinition, MetricKey } from '@/lib/metrics';
import { KPI_SET } from '@/components/overview/shared';

export type MetricRow = Derived & { name: string; share: number | null; previousShare?: number | null; previous: Derived | null };

export const HIDDEN_BY_DEFAULT: MetricKey[] = ['impressions', 'clicks', 'ctr', 'cpc', 'budget_lost_is', 'rank_lost_is'];
// Phones show the name plus the three that answer "where does the money go and
// what does it return"; Cost is the default sort.
export const MOBILE_KEPT: string[] = ['cost', 'conversions_value', 'roas'];

export interface MetricColumnOptions<T> {
  compare?: boolean;                       // false drops the comparison (period control on "no comparison")
  renderName?: (row: T) => ReactNode;      // default: the plain name
  before?: Column<T>[];                    // columns between the name and the metrics (network, status)
  after?: Column<T>[];                     // columns after IS (tROAS for Admin)
}

const metricColumn = <T extends MetricRow>(key: MetricKey, compare: boolean): Column<T> => ({
  key,
  label: key === 'impression_share' ? 'IS' : metricDefinition(key)?.label || key,
  numeric: true,
  hidden: HIDDEN_BY_DEFAULT.includes(key),
  mobileHidden: !MOBILE_KEPT.includes(key),
  render: r => formatMetric(key, r[key]),
  sortValue: r => r[key],
  ...(compare ? {
    compare: {
      previous: (r: T) => (r.previous ? r.previous[key] : null),
      format: (v: number | null) => formatMetric(key, v),
      deltaFormat: (v: number) => formatMetricDelta(key, v),
      higherIsBetter: metricDefinition(key)?.higherIsBetter ?? true,
    },
  } : {}),
});

export function metricColumns<T extends MetricRow>(nameLabel: string, options: MetricColumnOptions<T> = {}): Column<T>[] {
  const compare = options.compare !== false;
  return [
    { key: 'name', label: nameLabel, render: r => (options.renderName ? options.renderName(r) : r.name), sortValue: r => r.name },
    ...(options.before || []),
    // "Revenue share" sits next to Revenue and compares in points.
    ...KPI_SET.flatMap(key => (key === 'conversions_value'
      ? [metricColumn<T>('conversions_value', compare), {
        key: 'share', label: 'Revenue share', numeric: true, mobileHidden: true, render: r => fmtPercent(r.share), sortValue: r => r.share,
        ...(compare ? { compare: { previous: (r: T) => r.previousShare ?? null, format: (v: number | null) => fmtPercent(v), deltaFormat: (v: number) => `${(v * 100).toFixed(1)} pt`, higherIsBetter: null } } : {}),
      } as Column<T>]
      : [metricColumn<T>(key, compare)])),
    metricColumn<T>('impression_share', compare),
    ...(options.after || []),
  ];
}

// Campaign status as muted text next to the name (PAUSED / REMOVED only).
export const statusNote = (status: string) => (status === 'ENABLED' ? null : status === 'PAUSED' ? 'paused' : 'removed');

export function CampaignName({ name, status }: { name: string; status: string }) {
  const note = statusNote(status);
  return (
    <span className="font-medium">
      {name}
      {note && <span className="ml-1.5 text-xs font-normal text-subtle">{note}</span>}
    </span>
  );
}
