'use client';

// By network, category and campaign on the Overview: all full width and stacked; every KPI-tile metric is available
// as a column (the quieter ones start hidden), chosen through the column icon
// in the card header and remembered per table. With a comparison period
// chosen, the table's "Compare" toggle shows the previous value and the
// difference under every metric cell (Google Ads style).
import { useMemo } from 'react';
import { Card } from '@/components/Card';
import { DataTable, Column } from '@/components/DataTable';
import { fmtPercent, formatMetric, formatMetricDelta, metricDefinition, MetricKey } from '@/lib/metrics';
import { BreakdownRow, KPI_SET, OverviewView } from './shared';

type Row = BreakdownRow;

const HIDDEN_BY_DEFAULT: MetricKey[] = ['impressions', 'clicks', 'ctr', 'cpc', 'budget_lost_is', 'rank_lost_is'];

// Phones: name + Cost (the default sort), Revenue and ROAS
// answer "where does the money go and what does it return"; the rest via the column chooser.
const MOBILE_HIDDEN: MetricKey[] = ['conversions', 'cpa', 'aov', 'impression_share'];

const metricColumn = (key: MetricKey, compare: boolean): Column<Row> => ({
  key,
  label: key === 'impression_share' ? 'IS' : metricDefinition(key)?.label || key,
  numeric: true,
  hidden: HIDDEN_BY_DEFAULT.includes(key),
  mobileHidden: MOBILE_HIDDEN.includes(key),
  render: r => formatMetric(key, r[key]),
  sortValue: r => r[key],
  compare: compare
    ? { previous: r => (r.previous ? r.previous[key] : null), format: v => formatMetric(key, v), deltaFormat: v => formatMetricDelta(key, v), higherIsBetter: metricDefinition(key)?.higherIsBetter ?? true }
    : undefined,
});

// Share of revenue, compared with the share in the
// comparison period; the delta reads in points.
const shareColumn = (compare: boolean, _previousTotal: number): Column<Row> => ({
  key: 'share',
  label: 'Revenue share',
  numeric: true,
  mobileHidden: true,
  render: r => fmtPercent(r.share),
  sortValue: r => r.share,
  compare: compare
    ? { previous: r => r.previousShare ?? null, format: v => fmtPercent(v), deltaFormat: v => `${(v * 100).toFixed(1).replace('.', ',')} pt`, higherIsBetter: null }
    : undefined,
});

const columns = (nameLabel: string, compare: boolean, previousTotalCost: number): Column<Row>[] => [
  { key: 'name', label: nameLabel, render: r => r.name, sortValue: r => r.name },
  ...KPI_SET.flatMap(key => (key === 'conversions_value'
    ? [metricColumn('conversions_value', compare), shareColumn(compare, previousTotalCost)]
    : [metricColumn(key, compare)])),
  metricColumn('impression_share', compare),
];

export function BreakdownTables({ view }: { view: OverviewView; variant?: string }) {
  // "vs previous period" / "vs last year" on the tiles; empty = no comparison chosen,
  // then the columns carry no `compare` and the toggle stays hidden.
  const compareLabel = view.compareLabel.replace(/^vs /, '');
  const compare = compareLabel !== '' && view.previous !== null;
  const previousTotalCost = view.previous ? view.previous.cost : 0;
  const cols = useMemo(() => ({
    network: columns('Network', compare, previousTotalCost),
    category: columns('Category', compare, previousTotalCost),
    campaign: columns('Campaign', compare, previousTotalCost),
  }), [compare, previousTotalCost]);
  const footer: Row = { id: 'total', name: 'Total', ...view.current, share: 1, previousShare: view.previous ? 1 : null, previous: view.previous };
  const sort = { key: 'cost', direction: 'desc' as const };
  return (
    <div className="space-y-[var(--page-gap)]">
      <Card title="By network">
        <DataTable rows={view.byNetwork} columns={cols.network} rowKey={r => r.id} defaultSort={sort} storageKey="by-network" footer={footer} compareLabel={compareLabel} />
      </Card>
      <Card title="By category" subtitle="Derived from campaign names">
        <DataTable rows={view.byCategory} columns={cols.category} rowKey={r => r.id} defaultSort={sort} storageKey="by-category" maxRows={10} footer={footer} compareLabel={compareLabel} />
      </Card>
      <Card title="By campaign">
        <DataTable rows={view.byCampaign} columns={cols.campaign} rowKey={r => r.id} defaultSort={sort} storageKey="by-campaign" maxRows={15} footer={footer} compareLabel={compareLabel} />
      </Card>
    </div>
  );
}
