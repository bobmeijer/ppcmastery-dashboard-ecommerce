'use client';

// KPI tiles on the overview page.
import { StatCard } from '@/components/StatCard';
import { fmtNumber, formatMetric, metricDefinition, MetricKey } from '@/lib/metrics';
import { targetLabel } from '@/lib/reportShaping';
import type { TargetRow } from '@/lib/reports';
import { Delta, KPI_SET, OverviewView, Spark } from './shared';

const targetFor = (view: OverviewView, metric: MetricKey): TargetRow | null =>
  metric === 'roas' ? view.roasTarget : metric === 'cpa' ? view.cpaTarget : null;

const targetState = (metric: MetricKey, value: number | null, target: TargetRow | null): 'good' | 'bad' | null => {
  if (!target || value === null) return null;
  if (target.kind === 'max') return value <= target.value ? 'good' : 'bad';
  return value >= target.value ? 'good' : 'bad';
};

function Hint({ view, metric }: { view: OverviewView; metric: MetricKey }) {
  if (metric === 'conversions' && view.samples.count > 0) return <span className="text-xs text-muted">+ {fmtNumber(view.samples.count)} samples</span>;
  return null;
}

// B: sparkline
function TileSpark({ view, metric }: { view: OverviewView; metric: MetricKey }) {
  const def = metricDefinition(metric)!;
  const value = view.current[metric];
  const target = targetFor(view, metric);
  const state = targetState(metric, value, target);
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">{def.label}</span>
        <Delta metric={metric} current={value} previous={view.previous ? view.previous[metric] : undefined} />
      </div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight" style={state ? { color: state === 'good' ? 'var(--good)' : 'var(--bad)' } : undefined}>{formatMetric(metric, value)}</div>
      <div className="mt-2"><Spark values={view.periods.map(p => p[metric])} compare={view.comparePeriods.map(p => p[metric])} width={220} height={36} color={metric === 'cost' ? 'var(--accent)' : 'var(--ink)'} /></div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <span>{target ? `${targetLabel(target)} ${formatMetric(metric, target.value)}` : ''}</span>
        <Hint view={view} metric={metric} />
      </div>
    </div>
  );
}

// C: goal bar
function TileBar({ view, metric }: { view: OverviewView; metric: MetricKey }) {
  const def = metricDefinition(metric)!;
  const value = view.current[metric];
  const target = targetFor(view, metric);
  const state = targetState(metric, value, target);
  // Fill = progress toward the target (max targets invert: lower is better).
  let fill: number | null = null;
  if (target && value !== null && target.value > 0) {
    fill = target.kind === 'max' ? Math.min(1, target.value / Math.max(value, 0.0001)) : Math.min(1, value / target.value);
  }
  return (
    <div className="card p-4">
      <div className="eyebrow">{def.label}</div>
      <div className="num mt-2 text-2xl font-semibold tracking-tight">{formatMetric(metric, value)}</div>
      {fill !== null && target ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-alt">
            <div className="h-full rounded-full" style={{ width: `${Math.round(fill * 100)}%`, background: state === 'good' ? 'var(--good)' : 'var(--bad)' }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted"><span>{targetLabel(target)} {formatMetric(metric, target.value)}</span><span className="num">{Math.round(fill * 100)}%</span></div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between text-xs">
          <Delta metric={metric} current={value} previous={view.previous ? view.previous[metric] : undefined} suffix={view.compareLabel} />
          <Hint view={view} metric={metric} />
        </div>
      )}
    </div>
  );
}

// D: strip
function Strip({ view }: { view: OverviewView }) {
  return (
    <div className="card grid grid-cols-2 divide-y divide-line md:grid-cols-3 md:divide-y-0 xl:grid-cols-6 xl:divide-x">
      {KPI_SET.map(metric => {
        const def = metricDefinition(metric)!;
        const value = view.current[metric];
        const target = targetFor(view, metric);
        const state = targetState(metric, value, target);
        return (
          <div key={metric} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow">{def.label}</span>
            </div>
            <div className="num mt-1 text-xl font-semibold tracking-tight" style={state ? { color: state === 'good' ? 'var(--good)' : 'var(--bad)' } : undefined}>{formatMetric(metric, value)}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <Delta metric={metric} current={value} previous={view.previous ? view.previous[metric] : undefined} />
              {target && <span>{targetLabel(target)} {formatMetric(metric, target.value)}</span>}
              <Hint view={view} metric={metric} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KpiTiles({ view, variant }: { view: OverviewView; variant: string }) {
  if (variant === 'D') return <Strip view={view} />;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {KPI_SET.map(metric => {
        if (variant === 'B') return <TileSpark key={metric} view={view} metric={metric} />;
        if (variant === 'C') return <TileBar key={metric} view={view} metric={metric} />;
        // no target line on the tiles; the goal meters carry the targets.
        return (
          <StatCard key={metric} metric={metric} value={view.current[metric]} compare={view.previous ? view.previous[metric] : undefined} compareLabel={view.compareLabel}
            target={null}
            hint={metric === 'conversions' && view.samples.count > 0 ? `+ ${fmtNumber(view.samples.count)} samples` : undefined} />
        );
      })}
    </div>
  );
}
