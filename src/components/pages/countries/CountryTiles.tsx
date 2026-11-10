'use client';

// Countries: one tile per target country (NL, BE) plus a slim Other line.
import { change, fmtCurrency, fmtNumber, fmtPercent, formatMetric, metricDefinition, MetricKey } from '@/lib/metrics';
import { countryName, type CountrySummary, type OtherLine as OtherLineData } from '@/lib/geoShaping';
import { targetLabel } from '@/lib/reportShaping';
import type { TargetRow } from '@/lib/reports';

const TILE_METRICS: MetricKey[] = ['cost', 'conversions_value', 'roas', 'conversions', 'cpa'];

function Delta({ metric, current, previous, label }: { metric: MetricKey; current: number | null; previous: number | null | undefined; label: string }) {
  if (previous === undefined) return null;
  const d = change(current, previous ?? null);
  if (d === null) return <span className="text-xs text-subtle">no comparison</span>;
  const def = metricDefinition(metric);
  const good = def?.higherIsBetter === false ? d <= 0 : d >= 0;
  return <span className="num text-xs" style={{ color: good ? 'var(--good)' : 'var(--bad)' }}>{d >= 0 ? '+' : ''}{fmtPercent(d)}{label ? ` ${label}` : ''}</span>;
}

function ShareDelta({ current, previous, label }: { current: number | null; previous: number | null | undefined; label: string }) {
  if (previous === undefined || previous === null || current === null) return previous === undefined ? null : <span className="text-xs text-subtle">no comparison</span>;
  const points = (current - previous) * 100;
  return <span className="num text-xs text-muted">{points >= 0 ? '+' : ''}{fmtNumber(points, 1)} pt{label ? ` ${label}` : ''}</span>;
}

export function CountryTile({ summary, target, compareLabel }: { summary: CountrySummary; target: TargetRow | null; compareLabel: string }) {
  const prev = summary.previous;
  return (
    <div className="card p-4 lg:p-5">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold tracking-tight">{countryName(summary.code)}</h2>
          <span className="eyebrow">{summary.code}</span>
        </div>
        <div className="text-right">
          <span className="num text-sm font-medium">{fmtPercent(summary.share)}</span>
          <span className="text-xs text-muted"> of cost</span>
          <div><ShareDelta current={summary.share} previous={prev ? prev.share : undefined} label={compareLabel} /></div>
        </div>
      </header>
      {/* Phones: three across with a smaller figure, so a tile fits half a screen. */}
      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3 sm:mt-4 sm:gap-x-4 sm:gap-y-4 xl:grid-cols-5">
        {TILE_METRICS.map(metric => {
          const def = metricDefinition(metric)!;
          const value = summary[metric];
          const isRoas = metric === 'roas';
          // No green / red against the target: it is blended incl. Brand, no fair bar per country.
          return (
            <div key={metric}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="eyebrow">{def.label}</span>
              </div>
              <div className="num mt-1 text-lg font-semibold tracking-tight sm:text-xl">
                {formatMetric(metric, value)}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <Delta metric={metric} current={value} previous={prev ? prev[metric] : undefined} label="" />
                {isRoas && target && <span>{targetLabel(target)} {formatMetric('roas', target.value)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OtherLine({ summary, lines }: { summary: CountrySummary; lines: OtherLineData[] }) {
  if (summary.cost <= 0 && summary.impressions <= 0) {
    return <p className="text-sm text-muted">Other: no traffic outside NL and BE in this period.</p>;
  }
  return (
    <p className="text-sm text-muted">
      <span className="font-medium text-ink">Other</span>
      {' '}{fmtCurrency(summary.cost)} ({fmtPercent(summary.share)} of cost), revenue {fmtCurrency(summary.conversions_value)}, ROAS {formatMetric('roas', summary.roas)}
      {lines.length > 0 && (
        <>
          {': '}
          {lines.map((l, i) => (
            <span key={l.code} className="num">{i > 0 ? ', ' : ''}{l.name} {fmtCurrency(l.cost)} (ROAS {formatMetric('roas', l.roas)})</span>
          ))}
        </>
      )}
    </p>
  );
}
