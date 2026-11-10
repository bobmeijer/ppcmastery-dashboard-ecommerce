'use client';

// Product panel on Products: slides in from the right when a row
// is clicked. Header with the feed state, the KPIs of the page period, the
// trend with a label strip (one block per day), the label history and the
// split per campaign and country. Previous / next walk the current list.
import { LOCALE } from '@/lib/config';
import { useEffect, useMemo, useState } from 'react';
import { Column, DataTable } from '@/components/DataTable';
import { Notice, Skeleton } from '@/components/Card';
import { useScope } from '@/components/ScopeContext';
import { TrendChart } from '@/components/TrendChart';
import { availabilityLabel } from '@/components/pages/feed/shared';
import { addDays, accountToday, DateRange, daysBetween, fmtCurrency, fmtNumber, fmtPercent, formatMetric, isoDate, lagCutoff } from '@/lib/metrics';
import { dailyPoints, LabelPeriod, labelPeriods, periodTotals, ProductDayRow, splitBy, SplitRow, trendPoints } from '@/lib/productDetail';
import { labelName, ProductListRow } from '@/lib/productsShaping';
import { typeName } from '@/lib/productTypes';
import { FEED_ISSUE_TEXT } from '@/lib/feedIssues';
import { BucketChip, ProductThumb } from './ProductColumns';
import { safeHref } from '@/lib/safeUrl';

const DAILY_FLOOR = '2026-01-01'; // first day in the daily product table (PRODUCT_DAILY_FLOOR)

type Window = 'period' | 'd90' | 'ytd';
const WINDOWS: { value: Window; label: string }[] = [
  { value: 'period', label: 'Period' },
  { value: 'd90', label: '90 days' },
  { value: 'ytd', label: 'Since 1 January' },
];
type ChartMetric = 'conversions_value' | 'cost' | 'roas' | 'conversions' | 'clicks' | 'impressions';
const CHART_METRICS: { key: ChartMetric; label: string }[] = [
  { key: 'conversions_value', label: 'Revenue' },
  { key: 'cost', label: 'Cost' },
  { key: 'roas', label: 'ROAS' },
  { key: 'conversions', label: 'Purchases' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'impressions', label: 'Impressions' },
];

interface FeedRow { feed_label: string; price: number | null; currency: string | null; availability: string | null; ads_status: string | null; issues: { code: string; severity: string; description: string }[] }
interface ProductResponse { rows: ProductDayRow[]; feed: FeedRow[] }

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function windowRange(choice: Window, period: DateRange): DateRange {
  const yesterday = addDays(isoDate(accountToday()), -1);
  if (choice === 'd90') return { start: addDays(yesterday, -89), end: yesterday };
  if (choice === 'ytd') return { start: DAILY_FLOOR, end: yesterday };
  return period;
}

const periodColumns: Column<LabelPeriod>[] = [
  { key: 'label', label: 'Label', render: r => <BucketChip label={r.label} />, csv: r => labelName(r.label) },
  { key: 'start', label: 'From', render: r => shortDate(r.start), sortValue: r => r.start, csv: r => r.start },
  { key: 'end', label: 'To', mobileHidden: true, render: r => shortDate(r.end), sortValue: r => r.end, csv: r => r.end },
  { key: 'days', label: 'Days', numeric: true, render: r => <span title={`${r.activeDays} days with impressions`}>{fmtNumber(r.days)}</span>, sortValue: r => r.days, csv: r => r.days },
  { key: 'costPerDay', label: 'Cost per day', numeric: true, mobileHidden: true, render: r => formatMetric('cost', r.costPerDay), sortValue: r => r.costPerDay, csv: r => r.costPerDay.toFixed(2) },
  { key: 'cost', label: 'Cost', numeric: true, render: r => formatMetric('cost', r.cost), sortValue: r => r.cost, csv: r => r.cost.toFixed(2) },
  { key: 'conversions_value', label: 'Revenue', numeric: true, mobileHidden: true, render: r => formatMetric('conversions_value', r.conversions_value), sortValue: r => r.conversions_value, csv: r => r.conversions_value.toFixed(2) },
  { key: 'roas', label: 'ROAS', numeric: true, render: r => formatMetric('roas', r.roas), sortValue: r => r.roas, csv: r => r.roas?.toFixed(2) ?? '' },
];

const splitColumns = (label: string): Column<SplitRow>[] => [
  { key: 'name', label, render: r => <span className="block max-w-[16rem] truncate" title={r.name}>{r.name}</span>, sortValue: r => r.name, csv: r => r.name },
  { key: 'cost', label: 'Cost', numeric: true, render: r => formatMetric('cost', r.cost), sortValue: r => r.cost, csv: r => r.cost.toFixed(2) },
  { key: 'share', label: 'Share', numeric: true, mobileHidden: true, render: r => fmtPercent(r.share, 0), sortValue: r => r.share, csv: r => r.share?.toFixed(4) ?? '' },
  { key: 'conversions_value', label: 'Revenue', numeric: true, render: r => formatMetric('conversions_value', r.conversions_value), sortValue: r => r.conversions_value, csv: r => r.conversions_value.toFixed(2) },
  { key: 'roas', label: 'ROAS', numeric: true, render: r => formatMetric('roas', r.roas), sortValue: r => r.roas, csv: r => r.roas?.toFixed(2) ?? '' },
  { key: 'clicks', label: 'Clicks', numeric: true, mobileHidden: true, render: r => fmtNumber(r.clicks), sortValue: r => r.clicks, csv: r => r.clicks },
];

// One block per day in the label colour; days without data are drawn faint in
// the carried label. Padded to sit under the chart's plot area (phones: the chart's
// narrower y-axis, mobile-first pass 2026-10-16).
function LabelStrip({ points }: { points: { date: string; label: string | null; carried: string | null }[] }) {
  return (
    <div className="mt-1 flex h-3 gap-px pl-16 pr-4 max-sm:pl-[3.3rem] max-sm:pr-2" aria-label="Label per day">
      {points.map(p => (
        <span key={p.date} className="label-cell flex-1" data-label={p.label ?? p.carried ?? 'none'} data-empty={p.label === null || undefined}
          title={`${shortDate(p.date)}: ${p.label ? labelName(p.label) : p.carried ? `${labelName(p.carried)} (no impressions)` : 'no data'}`} />
      ))}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

// What the panel needs to know up front; Products passes a list row, Buckets a mover / transition product.
export type PanelProduct = Pick<ProductListRow, 'id' | 'title' | 'link' | 'image' | 'label' | 'type_l1' | 'type_l2' | 'ads_status' | 'in_feed'>;

interface Props {
  product: PanelProduct;
  scope: string;
  period: DateRange;
  lagDays: number;
  position: { index: number; total: number };
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
}

export function ProductPanel({ product, scope, period, lagDays, position, onPrev, onNext, onClose }: Props) {
  const { platform } = useScope();
  // Opens on the selected period: with 90 days the chart always ran
  // to yesterday, so a complete period like August still showed the lag band.
  const [choice, setChoice] = useState<Window>('period');
  const [metric, setMetric] = useState<ChartMetric>('conversions_value');
  const [data, setData] = useState<ProductResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chartRange = useMemo(() => windowRange(choice, period), [choice, period]);
  // One fetch covers both the chart window and the page period (KPIs, splits).
  const fetchRange = useMemo(() => ({
    start: [chartRange.start, period.start].sort()[0] < DAILY_FLOOR ? DAILY_FLOOR : [chartRange.start, period.start].sort()[0],
    end: [chartRange.end, period.end].sort()[1],
  }), [chartRange, period]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    const params = new URLSearchParams({ scope, id: product.id, start: fetchRange.start, end: fetchRange.end });
    if (platform === 'microsoft') params.set('platform', platform);
    fetch(`/api/report/product?${params.toString()}`)
      .then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`); return body as ProductResponse; })
      .then(body => { if (!cancelled) setData(body); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [scope, platform, product.id, fetchRange.start, fetchRange.end]);

  // Esc closes, arrow keys walk the list (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' && onNext) { e.preventDefault(); onNext(); }
      if (e.key === 'ArrowUp' && onPrev) { e.preventDefault(); onPrev(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onNext, onPrev]);

  const view = useMemo(() => {
    if (!data) return null;
    const all = dailyPoints(data.rows, fetchRange.start, fetchRange.end);
    const inChart = all.filter(p => p.date >= chartRange.start && p.date <= chartRange.end);
    const grain: 'day' | 'week' = daysBetween(chartRange.start, chartRange.end) > 92 ? 'week' : 'day';
    const cutoff = lagCutoff(lagDays);
    const chart = trendPoints(inChart, grain).map(p => ({ period: p.period, value: p[metric] as number | null, partial: p.partial }));
    const lagFrom = chart.find(p => p.period > cutoff)?.period ?? null;
    return {
      chart, grain, lagFrom, strip: inChart,
      periods: labelPeriods(inChart).reverse(),
      totals: periodTotals(all, period.start, period.end),
      campaigns: splitBy(data.rows, period.start, period.end, 'campaign'),
      countries: splitBy(data.rows, period.start, period.end, 'country'),
      feed: data.feed.find(f => f.feed_label === 'NL') || data.feed[0] || null,
    };
  }, [data, fetchRange, chartRange, period, metric, lagDays]);

  const metricLabel = CHART_METRICS.find(m => m.key === metric)?.label || metric;
  const issues = view?.feed?.issues || [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(10,10,10,0.18)]" onClick={onClose} aria-hidden />
      <aside className="product-panel fixed inset-y-0 right-0 z-50 flex w-[min(820px,100vw)] flex-col border-l border-line bg-paper" role="dialog" aria-label={product.title}>
        {/* Phones: the panel is the full screen (100vw); a smaller thumbnail keeps the
            fixed header short so the scroll area gets the room. */}
        <header className="flex items-start gap-4 border-b border-line p-4 max-sm:gap-3 max-sm:p-3 lg:p-5">
          <ProductThumb src={product.image} size={88} className="max-sm:!h-14 max-sm:!w-14" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              {product.link
                ? <a href={safeHref(product.link) ?? undefined} target="_blank" rel="noreferrer" className="text-base font-semibold leading-snug tracking-tight underline decoration-[var(--gray-300)] underline-offset-2 hover:decoration-[var(--ink)]">{product.title}</a>
                : <h2 className="text-base font-semibold leading-snug tracking-tight">{product.title}</h2>}
              <button type="button" className="btn-chip shrink-0" onClick={onClose} aria-label="Close">Close</button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="num">{product.id}</span>
              {product.label !== '' && <BucketChip label={product.label} />}
              <span>{typeName(product.type_l1)}{product.type_l2 ? ` > ${product.type_l2}` : ''}</span>
              {view?.feed?.price != null && <span className="num">{fmtCurrency(view.feed.price, 2)}</span>}
              {view?.feed && <span>{availabilityLabel(view.feed.availability)}</span>}
              {product.ads_status === 'NOT_ELIGIBLE' && <span style={{ color: 'var(--bad)' }}>not eligible for Shopping</span>}
              {!product.in_feed && <span>no longer in the feed</span>}
            </div>
            {issues.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {issues.map(i => (
                  <li key={i.code} style={{ color: i.severity === 'blocking' ? 'var(--bad)' : 'var(--ink-soft)' }}>
                    {FEED_ISSUE_TEXT[i.code]?.description || i.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </header>

        {/* Phones: 40px tall touch targets for previous / next. */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted max-sm:px-1 max-sm:py-0 lg:px-5">
          <button type="button" className="underline disabled:no-underline disabled:opacity-40 max-sm:min-h-10 max-sm:px-3" disabled={!onPrev} onClick={onPrev || undefined}>Previous</button>
          <span className="num">{position.index + 1} of {fmtNumber(position.total)}</span>
          <button type="button" className="underline disabled:no-underline disabled:opacity-40 max-sm:min-h-10 max-sm:px-3" disabled={!onNext} onClick={onNext || undefined}>Next</button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 max-sm:p-3 lg:p-5">
          {error && <Notice tone="bad">Product could not be loaded: {error}</Notice>}
          {!view && !error && <Skeleton rows={6} />}
          {view && (
            <>
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Selected period</h3>
                  <span className="text-xs text-muted">{shortDate(period.start)} to {shortDate(period.end)}</span>
                </div>
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
                  <Kpi label="Cost" value={formatMetric('cost', view.totals.cost)} />
                  <Kpi label="Revenue" value={formatMetric('conversions_value', view.totals.conversions_value)} />
                  <Kpi label="ROAS" value={formatMetric('roas', view.totals.roas)} />
                  <Kpi label="Purchases" value={fmtNumber(view.totals.conversions, 1)} />
                  <Kpi label="Clicks" value={fmtNumber(view.totals.clicks)} />
                  <Kpi label="CVR" value={fmtPercent(view.totals.cvr, 2)} />
                </div>
              </section>

              <section>
                {/* Phones: title and metric on one row, the window chips on the next. */}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 max-sm:justify-start max-sm:gap-1.5">
                  <h3 className="text-sm font-semibold">Trend {view.grain === 'week' ? 'per week' : 'per day'}</h3>
                  <div className="flex flex-wrap items-center gap-1.5 max-sm:contents">
                    <select value={metric} onChange={e => setMetric(e.target.value as ChartMetric)} aria-label="Metric" className="btn-chip max-sm:ml-auto">
                      {CHART_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                    <span className="hidden max-sm:block max-sm:basis-full" aria-hidden />
                    {WINDOWS.map(w => (
                      <button key={w.value} type="button" className="btn-chip" data-active={choice === w.value} onClick={() => setChoice(w.value)}>{w.label}</button>
                    ))}
                  </div>
                </div>
                <TrendChart data={view.chart} grain={view.grain} height={220} lagFrom={view.lagFrom}
                  series={[{ key: 'value', metric, label: metricLabel, color: 'var(--series-1)', type: metric === 'roas' ? 'line' : 'bar', axis: 'left' }]} />
                <LabelStrip points={view.strip} />
                <p className="mt-1.5 pl-16 text-[11px] text-muted max-sm:pl-[3.3rem]">Label per day; faded = no impressions that day. Daily data exists from 1 January 2026.</p>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Label history</h3>
                {view.periods.length === 0
                  ? <p className="text-sm text-muted">No label data in this window.</p>
                  : <DataTable rows={view.periods} columns={periodColumns} rowKey={r => `${r.label}-${r.start}`} csvName={`label-history-${product.id}`} />}
              </section>

              <section className="space-y-6">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">By campaign</h3>
                  {view.campaigns.length ? <DataTable rows={view.campaigns} columns={splitColumns('Campaign')} rowKey={r => r.name} csvName={`campaigns-${product.id}`} /> : <p className="text-sm text-muted">No data for this period.</p>}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">By country</h3>
                  {view.countries.length ? <DataTable rows={view.countries} columns={splitColumns('Country')} rowKey={r => r.name} csvName={`countries-${product.id}`} /> : <p className="text-sm text-muted">No data for this period.</p>}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
