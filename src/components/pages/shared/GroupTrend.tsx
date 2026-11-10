'use client';

// "Trend" block under a grouped table: the Trends view on demand. One metric
// at a time (KPI order, default revenue), one line per group for the top groups
// by cost, the lag window shaded for conversion-dependent metrics, the ROAS
// target as a dashed line when it applies.
import { useMemo, useState } from 'react';
import { Series, seriesColor, TrendChart } from '@/components/TrendChart';
import { KPI_SET } from '@/components/overview/shared';
import type { TargetRow } from '@/lib/reports';
import { FactRow, formatMetric, metricDefinition, MetricKey } from '@/lib/metrics';
import { lagStart, targetLabel } from '@/lib/reportShaping';
import { useIsPhone } from '@/hooks/useIsMobile';
import { groupTrend } from '@/lib/groupedShaping';

export const MAX_TREND_LINES = 6;

export interface GroupTrendProps {
  rows: FactRow[];
  keyOf: (row: FactRow) => string;
  grain: 'day' | 'week' | 'month';
  lagDays: number;
  includeLag: boolean;
  roasTarget: TargetRow | null;     // null when Brand is excluded (targets are blended)
  maxLines?: number;
}

export function GroupTrend({ rows, keyOf, grain, lagDays, includeLag, roasTarget, maxLines = MAX_TREND_LINES }: GroupTrendProps) {
  const [metric, setMetric] = useState<MetricKey>('conversions_value');
  const phone = useIsPhone();
  const def = metricDefinition(metric)!;
  const trend = useMemo(() => groupTrend(rows, keyOf, metric, maxLines), [rows, keyOf, metric, maxLines]);
  const lagFrom = includeLag && def.lagging ? lagStart(trend.points.map(p => p.period), lagDays, grain) : null;
  const series: Series[] = trend.names.map((name, index) => ({ key: name, metric, label: name, color: seriesColor(index), type: 'line', axis: 'left' }));
  const target = metric === 'roas' && roasTarget ? { value: roasTarget.value, label: `ROAS ${targetLabel(roasTarget)} ${formatMetric('roas', roasTarget.value)}`, axis: 'left' as const } : null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      {/* Phones: one row that scrolls sideways instead of four wrapped rows. */}
      <div className="mb-3 flex flex-wrap gap-1 max-sm:-mx-1 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-1 max-sm:pb-1" role="tablist" aria-label="Metric">
        {KPI_SET.map(key => (
          <button key={key} type="button" role="tab" aria-selected={metric === key} className="btn-chip shrink-0" data-active={metric === key} onClick={() => setMetric(key)}>
            {metricDefinition(key)?.label || key}
          </button>
        ))}
      </div>
      {trend.points.length === 0
        ? <p className="text-sm text-muted">No data for this period.</p>
        : <TrendChart data={trend.points} series={series} grain={grain} height={phone ? 240 : 320} /* lower on phones */ lagFrom={lagFrom} target={target} />}
    </div>
  );
}
