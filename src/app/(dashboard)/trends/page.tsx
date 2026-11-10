'use client';

// Trends: one metric at a time, in the KPI order.
// - Bars = raw periods (noise), strong line = rolling average (signal), dotted =
//   the comparison smoothed the same way, band = mean +/- 1.5 sd of the trailing
//   window; bars outside the band are anomalies (drawn dark).
// - Lag-honest: for conversion-dependent metrics the headline delta, the split
//   table and the band use complete days only; the rolling line inside the lag
//   window is drawn faded.
// - Comparison is weekday-aligned or the previous calendar unit (lib/compareRange).
// - Partial week or month buckets at the edges are drawn faint and skipped by
//   the rolling average.
// - No markers: promos and account changes get their own views.
import { LOCALE } from '@/lib/config';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Notice } from '@/components/Card';
import { TrendsSkeleton } from '@/components/PageSkeletons';
import { DataTable, Column } from '@/components/DataTable';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useScope } from '@/components/ScopeContext';
import { Marker, TrendChart } from '@/components/TrendChart';
import { useCampaignReport, useRangeReport } from '@/hooks/useReport';
import { applyFilters, displayNetwork, filterOptions } from '@/lib/filters';
import { addDays, change, daysBetween, Derived, fmtNumber, fmtPercent, formatMetric, groupBy, lagCutoff, metricDefinition, MetricKey, sumRows } from '@/lib/metrics';
import { activeTarget, byPeriod, lagStart, rollingBand, rollingPeriods, targetLabel, totals } from '@/lib/reportShaping';
import { LagBadge, AnomalyBadge } from '@/components/Badges';
import { useIsPhone } from '@/hooks/useIsMobile';

type Grain = 'day' | 'week' | 'month';
type Split = 'category' | 'campaign' | 'network';
const SPLITS: { value: Split; label: string; column: string }[] = [
  { value: 'category', label: 'Category', column: 'Category' },
  { value: 'campaign', label: 'Campaigns', column: 'Campaign' },
  { value: 'network', label: 'Network', column: 'Network' },
];
// Additive metrics have a meaningful absolute contribution to the total change; ratios do not.
const ADDITIVE: MetricKey[] = ['impressions', 'clicks', 'cost', 'conversions', 'conversions_value'];
type SplitRow = { name: string; value: number | null; previous: number | null; contribution: number | null };
const GRAINS: { value: Grain; label: string }[] = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }];

// Order fixed by Admin.
const TREND_METRICS: MetricKey[] = ['impressions', 'clicks', 'ctr', 'cpc', 'cost', 'conversions', 'cpa', 'cvr', 'conversions_value', 'roas', 'aov', 'budget_lost_is', 'rank_lost_is'];

type Rolling = 'off' | 'short' | 'long';
const WINDOWS: Record<Grain, { short: { size: number; label: string }; long: { size: number; label: string } }> = {
  day: { short: { size: 7, label: '7 days' }, long: { size: 28, label: '28 days' } },
  week: { short: { size: 4, label: '4 weeks' }, long: { size: 12, label: '12 weeks' } },
  month: { short: { size: 3, label: '3 months' }, long: { size: 6, label: '6 months' } },
};

type Row = {
  period: string;
  value: number | null;
  compare: number | null;       // raw comparison value (table)
  rolling: number | null;       // rolling average, complete part
  rollingLag: number | null;    // rolling average inside the lag window (faded)
  compareLine: number | null;   // comparison smoothed the same way (chart)
  band: [number, number] | null;
  anomaly: boolean;
  partial: boolean;             // week or month bucket cut by the range edge
  lag: boolean;                 // inside the lag window (lagging metrics only)
};

// Table dates as dd-mm-jjjj; weeks and months get a readable label.
const fmtPeriodCell = (iso: string, grain: Grain) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const dmy = d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  if (grain === 'week') return `week of ${dmy}`;
  if (grain === 'month') return d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return dmy;
};

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

// The rolling average needs window - 1 periods BEFORE the selected period.
function leadRange(start: string, grain: Grain, window: number): { start: string; end: string } | null {
  if (window <= 1) return null;
  const end = addDays(start, -1);
  if (grain === 'month') {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (window - 1), 1);
    return { start: d.toISOString().slice(0, 10), end };
  }
  return { start: addDays(start, -(window - 1) * (grain === 'week' ? 7 : 1)), end };
}

const bucketEnd = (period: string, grain: Grain) => {
  if (grain === 'day') return period;
  const d = new Date(`${period}T00:00:00Z`);
  if (grain === 'week') d.setUTCDate(d.getUTCDate() + 6); else d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};
// A week or month bucket is partial when it straddles the start or end of the range,
// or starts before the lead-in fetch. Buckets wholly before the range are complete
// lead-in periods for the rolling average.
const isPartial = (period: string, grain: Grain, range: { start: string; end: string }, leadStart?: string | null) =>
  grain !== 'day' && (
    (period < range.start && bucketEnd(period, grain) >= range.start)
    || bucketEnd(period, grain) > range.end
    || (!!leadStart && period < leadStart)
  );

export default function TrendsPage() {
  const { range, compare, lagDays, includeLag, filters } = useScope();
  const [grain, setGrain] = useState<Grain | undefined>(undefined);
  const [metric, setMetric] = useState<MetricKey>('conversions_value');
  const [rolling, setRolling] = useState<Rolling>('long');
  const [split, setSplit] = useState<Split>('category');
  const isPhone = useIsPhone();
  // Phones: keep the chosen metric chip in view inside the sideways-scrolling row.
  const metricRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = metricRow.current;
    const chip = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
    const left = chip.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + chip.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left - (row.clientWidth - chip.offsetWidth) / 2;
  }, [metric]);
  const { data, error, loading } = useCampaignReport(grain);
  const options = useMemo(() => (data ? filterOptions(data.rows) : null), [data]);
  useSetFilterOptions(options, loading && !data ? 'campaigns' : null);

  const def = metricDefinition(metric)!;
  const effectiveGrain: Grain = grain || data?.grain || 'day';
  const window = rolling === 'off' ? 1 : WINDOWS[effectiveGrain][rolling].size;
  const windowLabel = rolling === 'off' ? '' : WINDOWS[effectiveGrain][rolling].label;
  const lead = useMemo(() => (data ? leadRange(range.start, data.grain, window) : null), [data, range.start, window]);
  const leadReport = useRangeReport(lead, data?.grain);
  const compareLead = useMemo(() => (data && data.compareRange ? leadRange(data.compareRange.start, data.grain, window) : null), [data, window]);
  const compareLeadReport = useRangeReport(compareLead, data?.grain);

  const view = useMemo(() => {
    if (!data) return null;
    const g = data.grain;
    const lagging = def.lagging;
    const cutoff = lagCutoff(lagDays);                         // last complete day
    const compareCutoff = data.compareRange ? addDays(data.compareRange.start, daysBetween(range.start, cutoff) - 1) : null;
    const rows = applyFilters(data.rows, filters);
    const compareRows = applyFilters(data.compareRows, filters);
    const current = byPeriod(rows);
    const previous = byPeriod(compareRows);
    const partial = (p: string) => isPartial(p, g, range, lead?.start);
    const inLag = (p: string) => lagging && bucketEnd(p, g) > cutoff;

    // Rolling average and band over lead-in + period (partial buckets skipped), then the period's own points.
    const leadPeriods = leadReport.data && window > 1 ? byPeriod(applyFilters(leadReport.data.rows, filters)).filter(p => current.length === 0 || p.period < current[0].period) : [];
    const rollInput = [...leadPeriods, ...current].filter(p => !partial(p.period));
    const rolledMap = new Map(rollingPeriods(rollInput, window).map(r => [r.period, r.value]));
    const bandMap = new Map(rollingBand(rollInput.map(p => p[metric]), window).map((b, i) => [rollInput[i].period, b]));
    const compareLeadPeriods = compareLeadReport.data && window > 1 ? byPeriod(applyFilters(compareLeadReport.data.rows, filters)).filter(p => previous.length === 0 || p.period < previous[0].period) : [];
    const rolledCompare = rollingPeriods([...compareLeadPeriods, ...previous], window).slice(compareLeadPeriods.length);

    const lastComplete = [...current].reverse().find(p => !inLag(p.period))?.period ?? null;
    const anyLag = current.some(p => inLag(p.period));
    const chart: Row[] = current.map((p, i) => {
      const r = rolledMap.get(p.period) ?? null;
      const b = bandMap.get(p.period);
      const lag = inLag(p.period);
      const rollingValue = r ? r[metric] : null;
      return {
        period: p.period, value: p[metric],
        compare: previous[i] ? previous[i][metric] : null,
        // The two rolling segments share the last complete point so the line stays connected.
        rolling: !lag || p.period === lastComplete ? rollingValue : null,
        rollingLag: anyLag && (lag || p.period === lastComplete) ? rollingValue : null,
        compareLine: window > 1 ? (rolledCompare[i]?.value ? rolledCompare[i].value![metric] : null) : (previous[i] ? previous[i][metric] : null),
        band: b && b.low !== null && b.high !== null && !lag ? [b.low, b.high] : null,
        anomaly: !!b && b.anomaly && !lag && !partial(p.period),
        partial: partial(p.period),
        lag,
      };
    });

    const account = data.accounts.length === 1 ? data.accounts[0].id : null;
    // Targets are blended, so they disappear when Brand is excluded.
    const target = account && !filters.excludeBrand && (metric === 'roas' || metric === 'cpa') ? activeTarget(data.targets, account, metric, range.end) : null;

    // Headline and split: complete days only for lagging metrics (same slice on both sides).
    const completeRows = lagging ? rows.filter(r => bucketEnd(r.period, g) <= cutoff) : rows;
    const completeCompareRows = lagging && compareCutoff ? compareRows.filter(r => bucketEnd(r.period, g) <= compareCutoff) : compareRows;
    const cur = totals(completeRows);
    const prev = completeCompareRows.length ? totals(completeCompareRows) : null;
    const completeNote = lagging && cutoff < range.end ? `complete days up to ${fmtDate(cutoff < range.start ? range.start : cutoff)}` : null;
    const noComplete = lagging && completeRows.length === 0;

    const keyOf = (r: { network: string; category: string; campaign_name: string }) => (split === 'network' ? displayNetwork(r) : split === 'campaign' ? r.campaign_name : r.category);
    const nowBy = groupBy(completeRows, keyOf);
    const prevBy = groupBy(completeCompareRows, keyOf);
    const additive = ADDITIVE.includes(metric);
    const names = [...new Set([...nowBy.keys(), ...prevBy.keys()])];
    const splitRows: SplitRow[] = names.map(name => {
      const a: Derived | undefined = nowBy.get(name);
      const b: Derived | undefined = prevBy.get(name);
      const value = a ? a[metric] : null;
      const previousValue = b ? b[metric] : null;
      return { name, value, previous: previousValue, contribution: additive ? (value ?? 0) - (previousValue ?? 0) : null };
    }).sort((x, y) => (additive ? Math.abs(y.contribution ?? 0) - Math.abs(x.contribution ?? 0) : (y.value ?? -Infinity) - (x.value ?? -Infinity)));

    // No markers on the chart for now: account changes and
    // promos both get their own view; the chart stays clean.
    const markers: Marker[] = [];

    return {
      chart, target, splitRows, additive, markers,
      current: cur, previous: prev, completeNote, noComplete,
      anomalies: chart.filter(r => r.anomaly).length,
      fullTotal: sumRows(rows)[metric],
      // The lag shading only means something for conversion-dependent metrics.
      lagFrom: includeLag && lagging ? lagStart(current.map(p => p.period), lagDays, g) : null,
      freshest: Object.values(data.freshness).filter(Boolean).sort().pop() || null,
    };
  }, [data, lead, leadReport.data, compareLeadReport.data, filters, metric, def.lagging, window, split, range, lagDays, includeLag]);
  useSetFreshness(view?.freshest ?? null);

  const compareLabel = compare === 'year' ? 'last year' : 'previous period';
  const compareColumn = compare === 'year' ? 'Last year' : 'Previous period';
  const delta = view && view.previous ? change(view.current[metric], view.previous[metric]) : null;
  const deltaGood = delta === null ? null : def.higherIsBetter ? delta >= 0 : delta <= 0;

  const deltaSpan = (d: number | null) => {
    if (d === null) return '-';
    const good = def.higherIsBetter ? d >= 0 : d <= 0;
    return <span style={{ color: good ? 'var(--good)' : 'var(--bad)' }}>{d >= 0 ? '+' : ''}{fmtPercent(d)}</span>;
  };

  const columns: Column<Row>[] = [
    { key: 'period', label: 'Period', sortValue: r => r.period,
      // Phones: the badges wrap under the date instead of being cut off by the capped first column.
      render: r => <span className="flex items-center gap-2 max-sm:flex-wrap max-sm:gap-y-1">{fmtPeriodCell(r.period, effectiveGrain)}{r.lag && <LagBadge />}{r.partial && <span className="text-xs text-muted">partial</span>}{r.anomaly && <AnomalyBadge />}</span> },
    { key: 'value', label: def.label, numeric: true, render: r => formatMetric(metric, r.value), sortValue: r => r.value },
    ...(compare !== 'none' ? [
      // Phones: period, value and difference; the raw comparison value via the column chooser.
      { key: 'compare', label: compareColumn, numeric: true, mobileHidden: true, render: (r: Row) => formatMetric(metric, r.compare), sortValue: (r: Row) => r.compare },
      { key: 'delta', label: 'Change', numeric: true, render: (r: Row) => deltaSpan(change(r.value, r.compare)), sortValue: (r: Row) => change(r.value, r.compare) },
    ] : []),
    ...(window > 1 ? [{ key: 'rolling', label: `Avg ${windowLabel}`, numeric: true, hidden: true, render: (r: Row) => formatMetric(metric, r.rolling ?? r.rollingLag), sortValue: (r: Row) => r.rolling ?? r.rollingLag }] : []),
  ];

  const splitColumns: Column<SplitRow>[] = [
    { key: 'name', label: SPLITS.find(x => x.value === split)?.column || 'Category', render: r => r.name, sortValue: r => r.name },
    { key: 'value', label: def.label, numeric: true, render: r => formatMetric(metric, r.value), sortValue: r => r.value },
    ...(compare !== 'none' ? [
      // Phones: name, value and the column that answers "what explains it" (contribution for additive metrics, else difference).
      { key: 'previous', label: compareColumn, numeric: true, mobileHidden: true, render: (r: SplitRow) => formatMetric(metric, r.previous), sortValue: (r: SplitRow) => r.previous },
      { key: 'delta', label: 'Change', numeric: true, mobileHidden: !!view?.additive, render: (r: SplitRow) => deltaSpan(change(r.value, r.previous)), sortValue: (r: SplitRow) => change(r.value, r.previous) },
      ...(view?.additive ? [{ key: 'contribution', label: 'Contribution', numeric: true, sortValue: (r: SplitRow) => Math.abs(r.contribution ?? 0),
        render: (r: SplitRow) => (r.contribution === null ? '-' : <span className="num">{r.contribution >= 0 ? '+' : '-'}{formatMetric(metric, Math.abs(r.contribution))}</span>) }] : []),
    ] : []),
  ];

  const grainChips = (
    <div className="flex items-center gap-1" role="group" aria-label="Time grouping">
      {GRAINS.map(g => (
        <button key={g.value} type="button" className="btn-chip" data-active={effectiveGrain === g.value} onClick={() => setGrain(g.value)}>{g.label}</button>
      ))}
    </div>
  );

  const chips = (
    <div className="flex items-center gap-1" role="group" aria-label="Rolling average">
      <span className="text-xs text-muted">Average</span>
      <button type="button" className="btn-chip" data-active={rolling === 'off'} onClick={() => setRolling('off')}>Off</button>
      <button type="button" className="btn-chip" data-active={rolling === 'short'} onClick={() => setRolling('short')}>{WINDOWS[effectiveGrain].short.label}</button>
      <button type="button" className="btn-chip" data-active={rolling === 'long'} onClick={() => setRolling('long')}>{WINDOWS[effectiveGrain].long.label}</button>
    </div>
  );

  return (
    <div className="space-y-[var(--page-gap)]">
      {/* Phones: the 13 metric chips scroll sideways in one row instead of wrapping to three. */}
      <div className="flex flex-wrap items-center justify-between gap-3 max-lg:gap-2">
        <div className="flex flex-wrap gap-1 max-lg:-mx-3 max-lg:w-[calc(100%+1.5rem)] max-lg:flex-nowrap max-lg:overflow-x-auto max-lg:px-3 max-lg:[scrollbar-width:none]" role="tablist" ref={metricRow} aria-label="Metric">
          {TREND_METRICS.map(key => (
            <button key={key} type="button" role="tab" aria-selected={metric === key} className="btn-chip max-lg:shrink-0" data-active={metric === key} onClick={() => setMetric(key)}>
              {metricDefinition(key)?.label || key}
            </button>
          ))}
        </div>
        {grainChips}
      </div>

      {error && <Notice tone="bad">Report could not be loaded: {error}</Notice>}
      {loading && !data && <TrendsSkeleton />}

      {view && data && (
        <>
          <Card title={def.label} actions={chips}>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {view.noComplete ? (
                <span className="text-sm" style={{ color: 'var(--warn)' }}>All days in this period are still within the {lagDays}-day conversion lag.</span>
              ) : (
                <>
                  <span className="num kpi-value font-semibold tracking-tight">{formatMetric(metric, view.current[metric])}</span>
                  {delta !== null && <span className="num text-sm" style={{ color: deltaGood ? 'var(--good)' : 'var(--bad)' }}>{delta >= 0 ? '+' : ''}{fmtPercent(delta)} vs {compareLabel}</span>}
                  {view.completeNote && <span className="text-sm text-muted">{view.completeNote}</span>}
                  {view.completeNote && view.fullTotal !== null && <span className="num text-sm text-muted">whole period {formatMetric(metric, view.fullTotal)}</span>}
                </>
              )}
              {view.target && <span className="text-sm text-muted">{targetLabel(view.target)} {formatMetric(metric, view.target.value)}</span>}
              {window > 1 && view.anomalies > 0 && <span className="text-sm text-muted">{fmtNumber(view.anomalies)} {view.anomalies === 1 ? 'anomalous period' : 'anomalous periods'} outside the band</span>}
            </div>
            <TrendChart data={view.chart} grain={data.grain} height={isPhone ? 260 : 380} lagFrom={view.lagFrom} markers={view.markers}
              target={view.target ? { value: view.target.value, label: `${def.label} ${targetLabel(view.target)} ${formatMetric(metric, view.target.value)}`, axis: 'left' } : null}
              series={[
                ...(window > 1 ? [{ key: 'band', metric, label: 'Expected range', type: 'band' as const, axis: 'left' as const, color: 'var(--series-2)' }] : []),
                { key: 'value', metric, label: def.label, type: 'bar', axis: 'left', color: 'var(--series-1)', muted: window > 1 },
                ...(window > 1 ? [{ key: 'rolling', metric, label: `Average ${windowLabel}`, type: 'line' as const, axis: 'left' as const, color: 'var(--series-2)', strokeWidth: 2.5 }] : []),
                ...(window > 1 && def.lagging ? [{ key: 'rollingLag', metric, label: `Average ${windowLabel} (incomplete)`, type: 'line' as const, axis: 'left' as const, color: 'var(--series-2)', strokeWidth: 2.5, dashed: true, muted: true }] : []),
                ...(compare !== 'none' ? [{ key: 'compareLine', metric, label: window > 1 ? `Average ${windowLabel} (${compareLabel})` : `${def.label} (${compareLabel})`, type: 'line' as const, axis: 'left' as const, color: 'var(--series-4)', dashed: true }] : []),
              ]} />
          </Card>
          <div className="grid grid-cols-1 gap-[var(--page-gap)] xl:grid-cols-2">
            <Card title="By period">
              <DataTable rows={view.chart} columns={columns} rowKey={r => r.period} defaultSort={{ key: 'period', direction: 'desc' }} storageKey="trends-per-period" maxRows={10} />
            </Card>
            <Card title="What explains the change"
              actions={(
                <div className="flex items-center gap-1" role="group" aria-label="Breakdown">
                  {SPLITS.map(x => <button key={x.value} type="button" className="btn-chip" data-active={split === x.value} onClick={() => setSplit(x.value)}>{x.label}</button>)}
                </div>
              )}>
              {view.completeNote && <p className="mb-2 text-xs text-muted">{view.completeNote}, same length on both sides</p>}
              <DataTable rows={view.splitRows} columns={splitColumns} rowKey={r => r.name} storageKey={`trends-split-${split}`} maxRows={10} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
