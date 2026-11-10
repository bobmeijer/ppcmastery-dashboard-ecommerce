'use client';

import { RollingNumber } from '@/components/RollingNumber';
import { change, fmtPercent, formatMetric, metricDefinition, MetricKey } from '@/lib/metrics';

interface Props {
  metric: MetricKey;
  value: number | null;
  compare?: number | null;
  compareLabel?: string;
  target?: { value: number; kind: string; label: string } | null;
  hint?: string;
  label?: string;
}

export function StatCard({ metric, value, compare, compareLabel, target, hint, label }: Props) {
  const def = metricDefinition(metric);
  const delta = compare === undefined ? null : change(value, compare ?? null);
  const better = def && delta !== null ? (def.higherIsBetter ? delta >= 0 : delta <= 0) : null;
  let targetState: 'good' | 'bad' | null = null;
  if (target && value !== null) {
    if (target.kind === 'max') targetState = value <= target.value ? 'good' : 'bad';
    else targetState = value >= target.value ? 'good' : 'bad';
  }
  return (
    // Phones: tighter tile so the 12 KPI tiles take less than two screens.
    <div className="card p-4 max-sm:px-3 max-sm:py-3" data-state={targetState || undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">{label || def?.label || metric}</div>
      </div>
      <div className="num kpi-value mt-2 font-semibold max-sm:mt-1 tracking-tight" style={targetState ? { color: targetState === 'good' ? 'var(--good)' : 'var(--bad)' } : undefined}>
        <RollingNumber text={formatMetric(metric, value)} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
        {delta !== null && (
          <span className="num" style={{ color: better ? 'var(--good)' : 'var(--bad)' }}>
            {delta >= 0 ? '+' : ''}{fmtPercent(delta, 1)}{compareLabel ? ` ${compareLabel}` : ''}
          </span>
        )}
        {delta === null && compare !== undefined && <span>no comparison</span>}
        {target && <span>{target.label} {formatMetric(metric, target.value)}</span>}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}
