'use client';

// Account goals as two half-circle meters, above
// the KPI tiles on the Overview. Measured on the complete days of the selected
// period only: the lag window at the end is left out and the monthly revenue
// goal is pro-rated to those days. With Brand excluded the goals do not apply
// (they are blended targets) and the block collapses to a notice.
import { LOCALE } from '@/lib/config';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Notice } from '@/components/Card';
import { RollingNumber } from '@/components/RollingNumber';
import { useScope } from '@/components/ScopeContext';
import { useAccountGoals } from '@/hooks/useAccountGoals';
import { change, DateRange, fmtNumber, fmtPercent, formatMetric } from '@/lib/metrics';
import { clamp01, GoalStatus, latestCompleteStart, periodGoalViews } from '@/lib/goalsShaping';
import type { PeriodPoint } from '@/lib/reportShaping';
import { Bridge, fmtPart, largestParts, revenueBridge, roasBridge } from '@/lib/metricTree';

const tone = (status: GoalStatus | null) => (status === 'good' ? 'var(--good)' : status === 'bad' ? 'var(--bad)' : 'var(--gray-500)');
const eur = (value: number | null) => formatMetric('conversions_value', value);
const roasFmt = (value: number | null) => formatMetric('roas', value);
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Half circle, left (0) to right (1). 240 x 142 box, centre (120, 130), radius 92, 14px stroke.
const CX = 120;
const CY = 130;
const R = 92;
const polar = (fraction: number, r: number) => {
  const a = Math.PI * (1 - clamp01(fraction));
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
};
const arcPath = (fraction: number, r: number) => {
  const f = Math.min(0.9999, Math.max(0.0001, fraction));
  const s = polar(0, r);
  const e = polar(f, r);
  return `M${s.x.toFixed(2)} ${s.y.toFixed(2)} A${r} ${r} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
};

function Gauge({ fill, marker, markerLabel, endLabel, status, children }: {
  fill: number; marker: number; markerLabel: string; endLabel: string; status: GoalStatus | null; children: React.ReactNode;
}) {
  // Starts empty and sweeps to the value after the first paint.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(clamp01(fill)));
    return () => cancelAnimationFrame(id);
  }, [fill]);
  const m1 = polar(marker, R - 16);
  const m2 = polar(marker, R + 14);
  const label = polar(marker, R + 22);
  return (
    <div className="relative mx-auto" style={{ width: 240 }}>
      {/* The marker label runs past the 240px box; let it show instead of clipping. */}
      <svg width={240} height={142} viewBox="0 0 240 142" aria-hidden className="overflow-visible">
        <path d={arcPath(1, R)} fill="none" stroke="var(--gray-200)" strokeWidth={14} strokeLinecap="butt" />
        {/* One full-length arc revealed by dash offset, so a new period sweeps the fill instead of jumping */}
        <path d={arcPath(1, R)} pathLength={1} fill="none" stroke={tone(status)} strokeWidth={14} strokeLinecap="butt"
          className="gauge-fill" style={{ strokeDasharray: 1, strokeDashoffset: 1 - shown }} />
        <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke="var(--ink)" strokeWidth={2} />
        <text x={label.x} y={label.y} textAnchor={marker > 0.55 ? 'start' : marker < 0.45 ? 'end' : 'middle'} dominantBaseline="middle" fontSize={10} fill="var(--gray-500)">{markerLabel}</text>
        <text x={CX - R} y={CY + 11} fontSize={10} fill="var(--gray-400)" textAnchor="middle">0</text>
        <text x={CX + R} y={CY + 11} fontSize={10} fill="var(--gray-400)" textAnchor="middle">{endLabel}</text>
      </svg>
      <div className="absolute inset-x-0 bottom-3 text-center">{children}</div>
    </div>
  );
}

function Delta({ metric, current, previous, suffix }: { metric: 'conversions_value' | 'roas'; current: number | null; previous: number | null; suffix: string }) {
  const d = change(current, previous);
  if (d === null) return null;
  return <span className="num" style={{ color: d >= 0 ? 'var(--good)' : 'var(--bad)' }}>{d >= 0 ? '+' : ''}{fmtPercent(d)} {suffix}</span>;
}

const PART_LABEL: Record<string, string> = { impressions: 'Impressions', ctr: 'CTR', cvr: 'Conv. rate', aov: 'AOV', cpc: 'CPC' };

// The two largest contributions to the change (same complete slice as the meter), and the way into the tree.
function Drivers({ bridge, href }: { bridge: Bridge | null; href: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3 text-xs" style={{ borderColor: 'var(--gray-200)' }}>
      {bridge ? (
        <span className="text-muted">
          Biggest contributors:{' '}
          {largestParts(bridge, 2).map((p, i) => (
            <span key={p.key}>{i > 0 && ', '}<span className="text-ink-soft">{PART_LABEL[p.key]}</span> <span className="num font-medium" style={{ color: p.amount >= 0 ? 'var(--good)' : 'var(--bad)' }}>{fmtPart(bridge.total, p.amount)}</span></span>
          ))}
        </span>
      ) : <span className="text-muted">No breakdown of the change without a comparison period.</span>}
      <Link href={href} className="font-medium underline-offset-2 hover:underline" style={{ color: 'var(--ink)' }}>Why? See the metric tree</Link>
    </div>
  );
}

export interface GoalMetersProps {
  periods: PeriodPoint[];
  comparePeriods: PeriodPoint[];
  grain: 'day' | 'week' | 'month';
  range: DateRange;
  lagDays: number;
  excludeBrand: boolean;
  filtered?: boolean;          // another top-bar filter narrows the campaigns
  compareLabel: string;
}

export function GoalMeters({ periods, comparePeriods, grain, range, lagDays, excludeBrand, filtered, compareLabel }: GoalMetersProps) {
  const { compareRange, scope } = useScope();
  const params = useSearchParams();
  const treeHref = `/metric-tree${params.toString() ? `?${params.toString()}` : ''}`;
  const goals = useAccountGoals(scope);
  if (goals === undefined) return null;
  if (!goals) return <Notice tone="info">No goals set for this label yet.</Notice>;
  if (excludeBrand) return <Notice tone="info">Goals apply to the whole account including Brand, so they are hidden when Brand is excluded.</Notice>;
  if (filtered) return <Notice tone="info">Goals apply to the whole account, so they are hidden while a filter is active.</Notice>;

  const views = periodGoalViews(periods, comparePeriods, grain, range, lagDays, goals, undefined, compareRange?.start);
  if (!views) {
    return (
      <Notice tone="warn">
        All days in this period still fall within the {lagDays}-day conversion lag. Choose a period that starts on or before {fmtDate(latestCompleteStart(lagDays))} to see the goals.
      </Notice>
    );
  }

  const compareText = compareLabel ? compareLabel.replace(/^vs /, 'vs ') : '';
  const { window, days, lagDaysInRange, revenue, roas, totals, compareTotals } = views;
  const revenueParts = compareText && compareTotals ? revenueBridge(totals, compareTotals) : null;
  const roasParts = compareText && compareTotals ? roasBridge(totals, compareTotals) : null;
  const windowText = `${fmtDate(window.start)} to ${fmtDate(window.end)}, ${fmtNumber(days)} complete ${days === 1 ? 'day' : 'days'}`;
  const lagText = lagDaysInRange > 0 ? `last ${fmtNumber(lagDaysInRange)} days not counted yet (conversion lag)` : null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="eyebrow">Revenue vs goal</span>
          <span className="text-xs text-muted">{windowText}</span>
        </div>
        <div className="mt-3">
          {/* Scale runs to 125% of the pro-rated goal so overshoot stays visible; the goal sits at 80%. */}
          <Gauge fill={clamp01(revenue.fraction / 1.25)} marker={1 / 1.25} markerLabel={`goal ${eur(revenue.expected)}`} endLabel={eur(revenue.expected * 1.25)} status={revenue.status}>
            <div className="num kpi-value font-semibold tracking-tight" style={{ color: tone(revenue.status) }}><RollingNumber text={eur(revenue.actual)} /></div>
          </Gauge>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 text-xs text-muted">
          <span className="num">{fmtPercent(revenue.fraction, 0)} of goal</span>
          <span>goal pro rata from {eur(goals.revenuePerMonth)} per month</span>
          {compareText && <Delta metric="conversions_value" current={revenue.actual} previous={revenue.compare} suffix={compareText} />}
        </div>
        {lagText && <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted"><span>{lagText}</span></div>}
        <Drivers bridge={revenueParts} href={treeHref} />
      </div>
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="eyebrow">ROAS vs floor</span>
          <span className="text-xs text-muted">{windowText}</span>
        </div>
        <div className="mt-3">
          {/* Scale runs to 150% of the floor; the floor sits at two thirds. */}
          <Gauge fill={clamp01(roas.fraction / 1.5)} marker={1 / 1.5} markerLabel={`minimum ${roasFmt(roas.floor)}`} endLabel={roasFmt(roas.floor * 1.5)} status={roas.status}>
            <div className="num kpi-value font-semibold tracking-tight" style={{ color: tone(roas.status) }}><RollingNumber text={roasFmt(roas.actual)} /></div>
          </Gauge>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 text-xs text-muted">
          <span>minimum {roasFmt(roas.floor)} blended</span>
          {compareText && <Delta metric="roas" current={roas.actual} previous={roas.compare} suffix={compareText} />}
        </div>
        {lagText && <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted"><span>{lagText}</span></div>}
        <Drivers bridge={roasParts} href={treeHref} />
      </div>
    </div>
  );
}
