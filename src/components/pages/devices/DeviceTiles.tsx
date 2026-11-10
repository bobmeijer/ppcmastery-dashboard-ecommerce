'use client';

// One tile per device: share of cost as the headline, six metrics with deltas underneath.
// The conversion lag is flagged once, next to the period picker.
import { change, fmtNumber, fmtPercent, formatMetric, metricDefinition, MetricKey } from '@/lib/metrics';
import type { DeviceTile } from '@/lib/devicesShaping';

const TILE_METRICS: MetricKey[] = ['cost', 'conversions_value', 'roas', 'conversions', 'cpa', 'cvr'];

interface Target { value: number; kind: string; label: string }

function Delta({ metric, current, previous }: { metric: MetricKey; current: number | null; previous: number | null | undefined }) {
  if (previous === undefined) return null;
  const d = change(current, previous);
  if (d === null) return <span className="text-xs text-subtle">no comparison</span>;
  const higherIsBetter = metricDefinition(metric)?.higherIsBetter ?? true;
  const good = higherIsBetter ? d >= 0 : d <= 0;
  return <span className="num text-xs" style={{ color: good ? 'var(--good)' : 'var(--bad)' }}>{d >= 0 ? '+' : ''}{fmtPercent(d)}</span>;
}

function ShareDelta({ share, previousShare, compareLabel }: { share: number | null; previousShare: number | null; compareLabel: string }) {
  if (share === null || previousShare === null) return null;
  const points = (share - previousShare) * 100;
  return <span className="num">{points >= 0 ? '+' : ''}{fmtNumber(points, 1)} pt {compareLabel}</span>;
}

function Tile({ tile, compareLabel, roasTarget }: { tile: DeviceTile; compareLabel: string; roasTarget: Target | null }) {
  // No green / red against the target: it is blended incl. Brand, no fair bar per device.
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">{tile.label}</div>
      </div>
      <div className="num kpi-value mt-2 font-semibold tracking-tight">{fmtPercent(tile.share, 0)}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
        <span>of cost</span>
        <ShareDelta share={tile.share} previousShare={tile.previousShare} compareLabel={compareLabel} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3 border-t border-line pt-3">
        {TILE_METRICS.map(metric => {
          const def = metricDefinition(metric)!;
          const value = tile.current[metric];
          return (
            <div key={metric}>
              <dt className="eyebrow">{def.label}</dt>
              <dd className="num mt-0.5 text-sm font-medium">{formatMetric(metric, value)}</dd>
              <dd><Delta metric={metric} current={value} previous={tile.previous ? tile.previous[metric] : undefined} /></dd>
            </div>
          );
        })}
      </dl>
      {roasTarget && (
        <div className="mt-3 text-xs text-muted">ROAS {roasTarget.label} {formatMetric('roas', roasTarget.value)}</div>
      )}
    </div>
  );
}

export function DeviceTiles({ tiles, compareLabel, roasTarget }: { tiles: DeviceTile[]; compareLabel: string; roasTarget: Target | null }) {
  const wide = tiles.length >= 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3';
  return (
    <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${wide}`}>
      {tiles.map(tile => <Tile key={tile.key} tile={tile} compareLabel={compareLabel} roasTarget={roasTarget} />)}
    </div>
  );
}
