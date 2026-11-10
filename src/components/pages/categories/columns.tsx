'use client';

// Shared metric columns for the category table and its drill-down.
import type { Column } from '@/components/DataTable';
import { change, Derived, fmtNumber, fmtPercent, formatMetric, metricDefinition, MetricKey } from '@/lib/metrics';

export type MetricRow = Derived & { share: number | null; previous: Derived | null; target_roas?: number | null };

export function DeltaCell({ metric, current, previous }: { metric: MetricKey; current: number | null; previous: number | null | undefined }) {
  const delta = change(current, previous ?? null);
  if (delta === null) return <span className="text-subtle">-</span>;
  const good = metricDefinition(metric)?.higherIsBetter ? delta >= 0 : delta <= 0;
  return <span className="num" style={{ color: good ? 'var(--good)' : 'var(--bad)' }}>{delta >= 0 ? '+' : ''}{fmtPercent(delta)}</span>;
}

const deltaValue = (metric: MetricKey, row: MetricRow) => change(row[metric], row.previous ? row.previous[metric] : null);

export interface MetricColumnOptions {
  compareLabel: string;        // '' hides the delta columns
  showImpressionShare: boolean;
  showTargetRoas: boolean;     // admin only
}

// Phones keep Cost (default sort), Revenue and ROAS; the rest starts hidden.
export function metricColumns<T extends MetricRow>({ compareLabel, showImpressionShare, showTargetRoas }: MetricColumnOptions): Column<T>[] {
  const delta = (metric: MetricKey, label: string): Column<T>[] => (compareLabel ? [{
    key: `${metric}_delta`, label: `${label} vs ${compareLabel}`, numeric: true, mobileHidden: true,
    render: r => <DeltaCell metric={metric} current={r[metric]} previous={r.previous ? r.previous[metric] : null} />,
    sortValue: r => deltaValue(metric, r),
    csv: r => { const d = deltaValue(metric, r); return d === null ? '' : (d * 100).toFixed(1); },
  }] : []);
  return [
    { key: 'cost', label: 'Cost', numeric: true, render: r => formatMetric('cost', r.cost), sortValue: r => r.cost, csv: r => r.cost.toFixed(2) },
    { key: 'share', label: 'Share', numeric: true, mobileHidden: true, render: r => fmtPercent(r.share), sortValue: r => r.share, csv: r => (r.share === null ? '' : (r.share * 100).toFixed(1)) },
    { key: 'conversions_value', label: 'Revenue', numeric: true, render: r => formatMetric('conversions_value', r.conversions_value), sortValue: r => r.conversions_value, csv: r => r.conversions_value.toFixed(2) },
    ...delta('conversions_value', 'Revenue'),
    { key: 'roas', label: 'ROAS', numeric: true, render: r => formatMetric('roas', r.roas), sortValue: r => r.roas, csv: r => r.roas?.toFixed(2) ?? '' },
    ...delta('roas', 'ROAS'),
    ...(showTargetRoas ? [{
      key: 'target_roas', label: 'tROAS', numeric: true, mobileHidden: true,
      render: (r: T) => (r.target_roas ? <span className="text-muted">{formatMetric('roas', r.target_roas)}</span> : <span className="text-subtle">-</span>),
      sortValue: (r: T) => r.target_roas ?? null, csv: (r: T) => r.target_roas?.toFixed(2) ?? '',
    }] : []),
    { key: 'conversions', label: 'Purchases', numeric: true, mobileHidden: true, render: r => fmtNumber(r.conversions, 0), sortValue: r => r.conversions, csv: r => r.conversions.toFixed(1) },
    { key: 'cpa', label: 'CPA', numeric: true, mobileHidden: true, render: r => formatMetric('cpa', r.cpa), sortValue: r => r.cpa, csv: r => r.cpa?.toFixed(2) ?? '' },
    { key: 'aov', label: 'AOV', numeric: true, mobileHidden: true, render: r => formatMetric('aov', r.aov), sortValue: r => r.aov, csv: r => r.aov?.toFixed(2) ?? '' },
    ...(showImpressionShare ? [{
      key: 'impression_share', label: 'IS', numeric: true, mobileHidden: true,
      render: (r: T) => formatMetric('impression_share', r.impression_share), sortValue: (r: T) => r.impression_share,
      csv: (r: T) => (r.impression_share === null ? '' : (r.impression_share * 100).toFixed(1)),
    }] : []),
  ];
}
