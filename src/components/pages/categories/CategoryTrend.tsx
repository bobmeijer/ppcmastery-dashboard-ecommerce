'use client';

import { Card } from '@/components/Card';
import { TrendChart, Series } from '@/components/TrendChart';
import { formatMetric, MetricKey } from '@/lib/metrics';
import { OTHER, TrendPoint } from '@/lib/categoriesShaping';
import type { TargetRow } from '@/lib/reports';
import { targetLabel } from '@/lib/reportShaping';
import { useIsPhone } from '@/hooks/useIsMobile';

export type TrendMetric = 'conversions_value' | 'cost' | 'roas' | 'conversions';
export const TREND_METRICS: { key: TrendMetric; label: string }[] = [
  { key: 'conversions_value', label: 'Revenue' },
  { key: 'cost', label: 'Cost' },
  { key: 'roas', label: 'ROAS' },
  { key: 'conversions', label: 'Purchases' },
];

// Eight distinguishable lines on white; Other is always the grey one.
const LINE_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', '#2b6cb0', '#6b4ea1', '#0f8b8d', '#b7791f', '#c2417d'];
const lineColor = (name: string, index: number) => (name === OTHER ? 'var(--series-4)' : LINE_COLORS[index % LINE_COLORS.length]);

interface Props {
  names: string[];
  points: TrendPoint[];
  grain: 'day' | 'week' | 'month';
  metric: TrendMetric;
  onMetric: (metric: TrendMetric) => void;
  lagFrom: string | null;
  roasTarget: TargetRow | null;
  isProduct: boolean;
  note?: string;
}

export function CategoryTrend({ names, points, grain, metric, onMetric, lagFrom, roasTarget, isProduct, note }: Props) {
  const phone = useIsPhone();
  const data = points.map(p => ({ period: p.period, ...Object.fromEntries(names.map(name => [name, p.values[name] ? p.values[name][metric as MetricKey] : null])) }));
  const series: Series[] = names.map((name, index) => ({ key: name, metric: metric as MetricKey, label: name, color: lineColor(name, index), type: 'line', axis: 'left' }));
  const target = metric === 'roas' && roasTarget ? { value: roasTarget.value, label: `ROAS ${targetLabel(roasTarget)} ${formatMetric('roas', roasTarget.value)}`, axis: 'left' as const } : null;
  const subtitle = `One line per ${isProduct ? 'product type' : 'category'}, up to ${names.length > 8 ? 8 : names.length} plus ${OTHER}.${note ? ` ${note}` : ''}`;
  return (
    <Card title={isProduct ? 'Trend by product type' : 'Trend by category'} subtitle={subtitle}
      actions={
        <div className="flex flex-wrap gap-1">
          {TREND_METRICS.map(m => (
            <button key={m.key} type="button" className="btn-chip" data-active={metric === m.key} onClick={() => onMetric(m.key)}>{m.label}</button>
          ))}
        </div>
      }>
      <TrendChart data={data} series={series} grain={grain} height={phone ? 240 : 340} /* lower on phones */ lagFrom={lagFrom} target={target} />
    </Card>
  );
}
