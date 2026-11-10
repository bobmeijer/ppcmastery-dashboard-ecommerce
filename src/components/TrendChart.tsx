'use client';

import { LOCALE } from '@/lib/config';
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useState } from 'react';
import { formatMetric, MetricKey } from '@/lib/metrics';
import { useIsMobile, useIsPhone } from '@/hooks/useIsMobile';

export interface Series {
  key: string;
  metric: MetricKey;
  label: string;
  color: string;
  type: 'bar' | 'line' | 'band';   // band: the data key holds [low, high]
  axis: 'left' | 'right';
  dashed?: boolean;
  muted?: boolean;       // bars drawn light, so a line on top reads as the signal
  strokeWidth?: number;
  legend?: boolean;      // false hides it from the legend
  stack?: string;        // bars with the same stack id are stacked (Buckets history)
  format?: (value: number | null) => string;   // overrides the metric format (Quality Score: one decimal)
}

// Vertical markers: events on the timeline such as account
// changes or promos, so a trend is read next to its possible cause.
export interface Marker {
  period: string;
  label: string;
  tone?: 'ink' | 'accent';
}

interface Props {
  data: Record<string, unknown>[];
  series: Series[];
  lagFrom?: string | null;       // first period inside the lag window (shaded)
  target?: { value: number; label: string; axis: 'left' | 'right' } | null;
  markers?: Marker[];
  height?: number;
  leftMax?: number;              // fixed top of the left axis (e.g. 1 for 100% shares)
  grain: 'day' | 'week' | 'month';
}

const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-4)', 'var(--series-3)', 'var(--warn)', '#2b6cb0'];
export const seriesColor = (index: number) => COLORS[index % COLORS.length];

const periodLabel = (value: string, grain: 'day' | 'week' | 'month') => {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  if (grain === 'month') return date.toLocaleDateString(LOCALE, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

// Tooltip title: the date plus the weekday for days ("2 Sep, Wednesday"), the
// week's span for weeks, the month for months.
const tooltipLabel = (value: string, grain: 'day' | 'week' | 'month') => {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  if (grain === 'day') return `${periodLabel(value, grain)}, ${date.toLocaleDateString(LOCALE, { weekday: 'long', timeZone: 'UTC' })}`;
  if (grain === 'week') {
    const end = new Date(date);
    end.setUTCDate(end.getUTCDate() + 6);
    return `week of ${periodLabel(value, 'day')} to ${periodLabel(end.toISOString().slice(0, 10), 'day')}`;
  }
  return date.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

// Per-point styling flags a page may set on a data row.
type Flags = { partial?: boolean; anomaly?: boolean };

export function TrendChart({ data, series, lagFrom, target, markers, height = 300, grain, leftMax }: Props) {
  const hasRight = series.some(s => s.axis === 'right');
  const first = series.find(s => s.axis === 'left' && s.type !== 'band');
  const firstRight = series.find(s => s.axis === 'right');
  // Clicking a legend entry hides or shows that series.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  // Phones: narrower axes, smaller ticks spaced further apart,
  // a smaller legend and a short lag label so nothing clips in a ~340px plot. Height is the caller's.
  const phone = useIsPhone();
  const mobile = useIsMobile();   // the lag area is a few bars wide: short label below lg
  const tick = { fontSize: phone ? 10 : 11, fill: 'var(--gray-500)' };
  const toggle = (key: string) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: markers && markers.length ? 44 : 18, right: hasRight ? 8 : phone ? 8 : 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--gray-200)" vertical={false} />
        <XAxis dataKey="period" tickFormatter={v => periodLabel(String(v), grain)} tick={tick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={phone ? 32 : 24} />
        <YAxis yAxisId="left" tick={tick} tickLine={false} axisLine={false} width={phone ? 52 : 64}
          {...(leftMax !== undefined ? { domain: [0, leftMax], allowDataOverflow: true } : {})}
          tickFormatter={v => (first ? (first.format ? first.format(Number(v)) : formatMetric(first.metric, Number(v))) : String(v))} />
        {hasRight && (
          <YAxis yAxisId="right" orientation="right" tick={tick} tickLine={false} axisLine={false} width={phone ? 46 : 56}
            tickFormatter={v => (firstRight ? (firstRight.format ? firstRight.format(Number(v)) : formatMetric(firstRight.metric, Number(v))) : String(v))} />
        )}
        <Tooltip
          contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 12 }}
          separator=": "
          // The value itself first, then the averages, the comparison, the band last.
          itemSorter={(item: { name?: unknown }) => {
            const s = series.find(x => x.label === item.name);
            if (!s) return 9;
            if (s.type === 'bar') return 0;
            if (s.type === 'band') return 4;
            return s.dashed ? (s.muted ? 2 : 3) : 1;
          }}
          labelFormatter={v => tooltipLabel(String(v), grain)}
          formatter={(value: unknown, name: unknown) => {
            const s = series.find(x => x.label === name);
            if (!s) return [String(value), String(name)];
            if (s.type === 'band' && Array.isArray(value)) return [`${formatMetric(s.metric, Number(value[0]))} to ${formatMetric(s.metric, Number(value[1]))}`, String(name)];
            const v = value === null ? null : Number(value);
            return [s.format ? s.format(v) : formatMetric(s.metric, v), String(name)];
          }}
        />
        <Legend wrapperStyle={{ fontSize: phone ? 11 : 12, lineHeight: phone ? '18px' : undefined, cursor: 'pointer', userSelect: 'none' }} inactiveColor="var(--gray-300)"
          onClick={(entry: { dataKey?: unknown }) => { if (entry.dataKey !== undefined) toggle(String(entry.dataKey)); }} />
        {/* Phones: the lag label anchors right so a narrow band never pushes it past the chart edge. */}
        {lagFrom && data.some(d => String(d.period) >= lagFrom) && (
          <ReferenceArea yAxisId="left" x1={lagFrom} x2={String(data[data.length - 1]?.period)} fill="var(--ink)" fillOpacity={0.05}
            label={{ value: mobile ? 'incomplete' : 'conversions still incomplete', position: mobile ? 'insideTopRight' : 'insideTopLeft', fontSize: 10, fill: 'var(--gray-500)' }} />
        )}
        {target && (
          <ReferenceLine yAxisId={target.axis} y={target.value} stroke="var(--accent)" strokeDasharray="4 4"
            label={{ value: target.label, position: 'insideBottomRight', fontSize: 10, fill: 'var(--accent)' }} />
        )}
        {/* Labels cycle over three rows so neighbouring markers stay legible. */}
        {markers && [...markers].sort((a, b) => a.period.localeCompare(b.period)).map((m, i) => (
          <ReferenceLine key={`${m.period}-${m.label}`} yAxisId="left" x={m.period} stroke={m.tone === 'accent' ? 'var(--accent)' : 'var(--ink)'} strokeOpacity={0.55} strokeDasharray="2 3"
            label={{ value: m.label.length > 22 ? `${m.label.slice(0, 21)}...` : m.label, position: 'top', dy: -2 - (2 - (i % 3)) * 12, fontSize: 10, fill: m.tone === 'accent' ? 'var(--accent)' : 'var(--ink-soft)' }} />
        ))}
        {series.map(s => {
          if (s.type === 'band') {
            return <Area key={s.key} yAxisId={s.axis} dataKey={s.key} name={s.label} type="monotone" stroke="none" fill={s.color} fillOpacity={0.06} connectNulls={false} isAnimationActive={false} legendType="none" hide={hidden.has(s.key)} />;
          }
          if (s.type === 'bar') {
            return (
              <Bar key={s.key} yAxisId={s.axis} dataKey={s.key} name={s.label} fill={s.color} stackId={s.stack} fillOpacity={s.muted ? 0.22 : s.dashed ? 0.35 : 0.9} radius={s.stack ? 0 : [3, 3, 0, 0]} maxBarSize={s.stack ? 36 : 28} isAnimationActive={false} hide={hidden.has(s.key)}>
                {data.map((d, i) => {
                  const f = d as Flags;
                  const opacity = f.anomaly ? 0.9 : f.partial ? 0.1 : s.muted ? 0.22 : s.dashed ? 0.35 : 0.9;
                  return <Cell key={i} fillOpacity={opacity} />;
                })}
              </Bar>
            );
          }
          return (
            <Line key={s.key} yAxisId={s.axis} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={s.strokeWidth ?? 2} dot={false} isAnimationActive={false}
              strokeDasharray={s.dashed ? '4 4' : undefined} strokeOpacity={s.muted ? 0.5 : 1} connectNulls={false} type="monotone" legendType={s.legend === false ? 'none' : undefined} hide={hidden.has(s.key)} />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
