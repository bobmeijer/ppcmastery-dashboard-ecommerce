'use client';

// Product part of the Buckets page: distribution per label (label
// at the time / current label), bucket history, what a switch does, and the
// transitions matrix that filters the movers below it. The data is shaped on
// the server (src/lib/bucketsHistory.ts). Clicking a product opens the same
// panel as on Products.
import { LOCALE } from '@/lib/config';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useHrefWith } from '@/components/pageLinks';
import { Card } from '@/components/Card';
import { Column, DataTable } from '@/components/DataTable';
import { InfoTip } from '@/components/Badges';
import { TrendChart } from '@/components/TrendChart';
import { useScope } from '@/components/ScopeContext';
import { BucketChip, TitleCell } from '@/components/pages/products/ProductColumns';
import { PanelProduct, ProductPanel } from '@/components/pages/products/ProductPanel';
import { fmtNumber, fmtPercent, formatMetric, lagCutoff } from '@/lib/metrics';
import type { BucketHistoryView, Direction, HistoryPoint, Mover, ProductInfo, SwitchEffect } from '@/lib/bucketsHistory';
import { labelName } from '@/lib/productsShaping';
import { useIsPhone } from '@/hooks/useIsMobile';

const LABEL_COLOR: Record<string, string> = { H: 'var(--good)', S: 'var(--warn)', V: 'var(--bad)', Z: 'var(--gray-400)', none: 'var(--gray-300)' };
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

const MODE_INFO = 'Label at the time: each day counts under the label the product had that day, the way Google Ads and the bucket campaigns count it. A product that switched counts in both labels. Current label: the whole period counts under the label the product has in the feed now, like the donuts in ProductHero. That is circular: a product is a hero because it performed well, so heroes always look good in that view.';

// Shared panel state: one open product per block, prev / next walk that block's list.
function usePanel(list: PanelProduct[]) {
  const [openId, setOpenId] = useState<string | null>(null);
  const index = openId ? list.findIndex(p => p.id === openId) : -1;
  return { openId, setOpenId, index, open: index >= 0 ? list[index] : null };
}

function Panel({ list, state }: { list: PanelProduct[]; state: ReturnType<typeof usePanel> }) {
  const { scope, range, lagDays } = useScope();
  if (!state.open) return null;
  return (
    <ProductPanel product={state.open} scope={scope} period={range} lagDays={lagDays} position={{ index: state.index, total: list.length }}
      onPrev={state.index > 0 ? () => state.setOpenId(list[state.index - 1].id) : null}
      onNext={state.index < list.length - 1 ? () => state.setOpenId(list[state.index + 1].id) : null}
      onClose={() => state.setOpenId(null)} />
  );
}

const infoFor = (view: BucketHistoryView, id: string): ProductInfo =>
  view.products[id.toLowerCase()] || { id, title: id, image: null, link: null, type_l1: '', type_l2: '', label: '', in_feed: false, ads_status: null };

// Up (V > H) green, down (H > V) red, back to where it started grey.
const DIRECTION_TEXT: Record<Direction, string> = { up: 'upgraded', down: 'downgraded', flip: 'back and forth' };
function DirectionMark({ direction }: { direction: Direction }) {
  const color = direction === 'up' ? 'var(--good)' : direction === 'down' ? 'var(--bad)' : 'var(--gray-400)';
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-label={DIRECTION_TEXT[direction]}>
      <title>{DIRECTION_TEXT[direction]}</title>
      {direction === 'up' ? <path d="M6 15l6-6 6 6" /> : direction === 'down' ? <path d="M6 9l6 6 6-6" /> : <path d="M4 12h16" />}
    </svg>
  );
}

// ROAS after the switch, coloured against the same product before it (fair, unlike the blended account target).
const roasAfter = (after: number | null, before: number | null) => {
  const color = after === null || before === null || after === before ? undefined : after > before ? 'var(--good)' : 'var(--bad)';
  return <span style={color ? { color } : undefined}>{formatMetric('roas', after)}</span>;
};

const changeText = (v: number | null) => (v === null ? '-' : `${v >= 0 ? '+' : ''}${fmtPercent(v, 0)}`);

// --- 1. buckets (tiles) ------------------------------------------------------------

// the bucket tiles from Products replace the distribution
// table here, with the two counting modes kept and the tiles sharing the full
// card width. A tile opens Products filtered on that bucket.
export function LabelDistribution({ view }: { view: BucketHistoryView; slug: string }) {
  const [mode, setMode] = useState<'moment' | 'current'>('moment');
  const rows = view.distribution[mode].filter(r => r.label !== '');
  const total = view.distribution_total;
  const hrefWith = useHrefWith();
  return (
    <Card
      heading={(
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-base font-semibold tracking-tight">Buckets</h2>
            <InfoTip label="Label at the time or current label" text={MODE_INFO} />
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn-chip" data-active={mode === 'moment'} onClick={() => setMode('moment')}>Label at the time</button>
              <button type="button" className="btn-chip" data-active={mode === 'current'} onClick={() => setMode('current')}>Current label</button>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">
            {fmtNumber(total.products)} products, {formatMetric('cost', total.cost)} cost, {formatMetric('conversions_value', total.conversions_value)} revenue, ROAS {formatMetric('roas', total.roas)}. Click a bucket for its products.
          </p>
        </div>
      )}>
      <div className="bucket-grid" style={{ ['--n' as string]: Math.max(1, rows.length) }}>
        {rows.map(b => (
          <Link key={b.label} href={hrefWith('/products', { bucket: b.label })} className="bucket-tile block" data-label={b.label}
            title={`View ${labelName(b.label)} on Products`}>
            <div className="flex items-baseline justify-between gap-2">
              <BucketChip label={b.label} />
              {/* Phones: the count alone; "products" would wrap under it in a half-width tile. */}
              <span className="num text-sm font-semibold">{fmtNumber(b.products)} <span className="text-xs font-normal text-muted max-sm:sr-only">products</span></span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Cost</dt><dd className="num text-right">{formatMetric('cost', b.cost)} <span className="text-muted max-sm:block">{fmtPercent(b.cost_share, 0)}</span></dd>
              <dt className="text-muted">Revenue</dt><dd className="num text-right">{formatMetric('conversions_value', b.conversions_value)} <span className="text-muted max-sm:block">{fmtPercent(b.revenue_share, 0)}</span></dd>
              <dt className="text-muted">ROAS</dt><dd className="num text-right font-medium">{formatMetric('roas', b.roas)}</dd>
              <dt className="text-muted">Purchases</dt><dd className="num text-right">{fmtNumber(b.conversions, 0)}</dd>
            </dl>
          </Link>
        ))}
      </div>
    </Card>
  );
}

// --- 2. history ------------------------------------------------------------------

type HistoryMetric = 'cost' | 'value' | 'products';
const HISTORY_METRICS: { value: HistoryMetric; label: string }[] = [
  { value: 'cost', label: 'Cost' },
  { value: 'value', label: 'Revenue' },
  { value: 'products', label: 'Products' },
];

// % mode: each period's labels as a share of that period's total (100% stacked).
function toShares(points: HistoryPoint[], metric: HistoryMetric, labels: string[]): HistoryPoint[] {
  return points.map(p => {
    const keys = labels.map(l => `${metric}_${l || 'none'}`);
    const total = keys.reduce((a, k) => a + Number(p[k] || 0), 0);
    const out: HistoryPoint = { period: p.period, ...(p.partial ? { partial: true } : {}) };
    for (const k of keys) out[k] = total > 0 ? Number(p[k] || 0) / total : 0;
    return out;
  });
}

export function BucketHistory({ view }: { view: BucketHistoryView }) {
  const { lagDays } = useScope();
  const [metric, setMetric] = useState<HistoryMetric>('cost');
  const [share, setShare] = useState(false);
  const phone = useIsPhone();
  const cutoff = lagCutoff(lagDays);
  const data = useMemo(() => (share ? toShares(view.history, metric, view.history_labels) : view.history), [share, view.history, metric, view.history_labels]);
  const lagFrom = view.history.find(p => p.period > cutoff)?.period ?? null;
  const series = view.history_labels.map(label => ({
    key: `${metric}_${label || 'none'}`,
    metric: share ? 'ctr' as const : metric === 'cost' ? 'cost' as const : metric === 'value' ? 'conversions_value' as const : 'impressions' as const,
    label: labelName(label),
    color: LABEL_COLOR[label || 'none'] || 'var(--gray-300)',
    type: 'bar' as const,
    axis: 'left' as const,
    stack: 'labels',
  }));
  return (
    <Card
      heading={(
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-base font-semibold tracking-tight">Bucket trend</h2>
          <span className="text-sm text-muted">per {view.grain === 'week' ? 'week' : 'day'}, label at the time</span>
        </div>
      )}
      actions={(
        <div className="flex flex-wrap items-center gap-1.5">
          {HISTORY_METRICS.map(m => <button key={m.value} type="button" className="btn-chip" data-active={metric === m.value} onClick={() => setMetric(m.value)}>{m.label}</button>)}
          <span className="mx-1 h-4 border-l border-line max-sm:hidden" aria-hidden />
          <button type="button" className="btn-chip" data-active={!share} onClick={() => setShare(false)}>Absolute</button>
          <button type="button" className="btn-chip" data-active={share} onClick={() => setShare(true)}>%</button>
        </div>
      )}>
      {view.history.length === 0
        ? <p className="text-sm text-muted">No product data for this period.</p>
        : <TrendChart data={data} series={series} grain={view.grain} height={phone ? 240 : 300} lagFrom={metric === 'value' ? lagFrom : null} />}
      {metric === 'products' && <p className="mt-2 text-xs text-muted">Number of products with impressions per label; a product that switched counts in both labels.</p>}
    </Card>
  );
}

// --- 3. what a switch does -------------------------------------------------------

// Direction as a labelled pill in its own first column (the
// small arrow was not clear enough). Sorting on it groups all upgrades first,
// then the downgrades, each by number of products.
const DIRECTION_PILL: Record<Direction, string> = { up: 'Up', down: 'Down', flip: 'Same' };
const DirectionPill = ({ direction }: { direction: Direction }) => (
  <span className="direction-pill" data-direction={direction} title={DIRECTION_TEXT[direction]}>{DIRECTION_PILL[direction]}</span>
);

// Phones keep direction, switch, products and the ROAS difference.
const effectColumns: Column<SwitchEffect>[] = [
  {
    key: 'direction', label: 'Direction', render: r => <DirectionPill direction={r.direction} />,
    sortValue: r => (r.direction === 'up' ? 0 : r.direction === 'down' ? 1 : 2) * 100000 - r.products, csv: r => DIRECTION_PILL[r.direction],
  },
  {
    key: 'switch', label: 'Switch',
    render: r => <span className="inline-flex items-center gap-1 whitespace-nowrap"><BucketChip label={r.from} phoneShort /><span className="text-xs text-muted">to</span><BucketChip label={r.to} phoneShort /></span>,
    sortValue: r => `${r.from}${r.to}`, csv: r => `${labelName(r.from)} > ${labelName(r.to)}`,
  },
  { key: 'products', label: 'Products', numeric: true, render: r => fmtNumber(r.products), sortValue: r => r.products, csv: r => r.products },
  { key: 'cpd_before', label: 'Cost/day before', numeric: true, mobileHidden: true, render: r => formatMetric('cost', r.before.costPerDay), sortValue: r => r.before.costPerDay, csv: r => r.before.costPerDay.toFixed(2) },
  { key: 'cpd_after', label: 'Cost/day after', numeric: true, mobileHidden: true, render: r => formatMetric('cost', r.after.costPerDay), sortValue: r => r.after.costPerDay, csv: r => r.after.costPerDay.toFixed(2) },
  { key: 'cpd_change', label: 'Change', numeric: true, mobileHidden: true, render: r => changeText(r.costPerDayChange), sortValue: r => r.costPerDayChange, csv: r => r.costPerDayChange?.toFixed(4) ?? '' },
  { key: 'roas_before', label: 'ROAS before', numeric: true, mobileHidden: true, render: r => formatMetric('roas', r.before.roas), sortValue: r => r.before.roas, csv: r => r.before.roas?.toFixed(2) ?? '' },
  { key: 'roas_after', label: 'ROAS after', numeric: true, mobileHidden: true, render: r => roasAfter(r.after.roas, r.before.roas), sortValue: r => r.after.roas, csv: r => r.after.roas?.toFixed(2) ?? '' },
  { key: 'roas_change', label: 'Change', numeric: true, render: r => changeText(r.roasChange), sortValue: r => r.roasChange, csv: r => r.roasChange?.toFixed(4) ?? '' },
];

export function SwitchEffects({ view, slug }: { view: BucketHistoryView; slug: string }) {
  const info = `By type of switch: the label period just before the last switch against the period after it, summed across all products with that switch. Complete days only (to ${shortDate(view.effects_cutoff)}), so outside the conversion lag; a switch still inside the lag does not count. Cost per day = per day with impressions.`;
  return (
    <Card
      heading={(
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-base font-semibold tracking-tight">What a switch does</h2>
          <InfoTip label="What a switch does" text={info} />
          <span className="text-sm text-muted">complete days to {shortDate(view.effects_cutoff)}</span>
        </div>
      )}>
      {view.effects.length === 0
        ? <p className="text-sm text-muted">No label switches with complete days on both sides in this period.</p>
        : <DataTable rows={view.effects} columns={effectColumns} rowKey={r => `${r.from}>${r.to}`} defaultSort={{ key: 'direction', direction: 'asc' }} csvName={`${slug}-switch-effect`} />}
    </Card>
  );
}

// --- 4. transitions + movers -----------------------------------------------------

// One block per day of the period: solid on days with data, faint when carried.
function MiniStrip({ strip }: { strip: string }) {
  return (
    <span className="mini-strip" aria-hidden>
      {[...strip].map((c, i) => <span key={i} data-label={c === '.' ? 'none' : c.toUpperCase()} data-empty={c !== c.toUpperCase() || c === '.' || undefined} />)}
    </span>
  );
}

const Path = ({ path, direction }: { path: string[]; direction: Direction }) => (
  // One line, never wrapped.
  <span className="inline-flex flex-nowrap items-center gap-1 whitespace-nowrap">
    {path.map((l, i) => (
      <span key={i} className="inline-flex items-center gap-1">
        {i > 0 && <span className="text-xs text-muted">&gt;</span>}
        <BucketChip label={l} phoneShort />
      </span>
    ))}
    <DirectionMark direction={direction} />
  </span>
);

export function Transitions({ view, slug }: { view: BucketHistoryView; slug: string }) {
  const [cell, setCell] = useState<{ from: string; to: string } | null>(null);
  const { labels, cells } = view.transitions;
  const phone = useIsPhone();
  // Shading by number of products that switched.
  const maxMoved = Math.max(1, ...cells.map(c => c.moved));
  const rows = useMemo(() => (cell ? view.movers.filter(m => m.from === cell.from && m.to === cell.to) : view.movers), [cell, view.movers]);
  const list = useMemo<PanelProduct[]>(() => rows.map(m => infoFor(view, m.id)), [rows, view]);
  const panel = usePanel(list);
  const products = cells.reduce((a, c) => a + c.count, 0);

  // Phones: product, cost (the default sort) and ROAS after the switch; the path is in the
  // filtered matrix cell and the product panel.
  const columns: Column<Mover>[] = [
    { key: 'title', label: 'Product', render: r => <TitleCell row={infoFor(view, r.id)} />, sortValue: r => infoFor(view, r.id).title, csv: r => infoFor(view, r.id).title },
    { key: 'path', label: 'Labels', mobileHidden: true, render: r => <Path path={r.path} direction={r.direction} />, sortValue: r => r.path.join(''), csv: r => r.path.map(labelName).join(' > ') },
    { key: 'strip', label: 'Per day', mobileHidden: true, render: r => <MiniStrip strip={r.strip} />, csv: r => r.strip },
    { key: 'switch', label: 'Last switch', mobileHidden: true, render: r => shortDate(r.switchDate), sortValue: r => r.switchDate, csv: r => r.switchDate },
    { key: 'cpd_before', label: 'Cost/day before', numeric: true, mobileHidden: true, render: r => formatMetric('cost', r.before.costPerDay), sortValue: r => r.before.costPerDay, csv: r => r.before.costPerDay.toFixed(2) },
    { key: 'cpd_after', label: 'Cost/day after', numeric: true, mobileHidden: true, render: r => formatMetric('cost', r.after.costPerDay), sortValue: r => r.after.costPerDay, csv: r => r.after.costPerDay.toFixed(2) },
    { key: 'roas_before', label: 'ROAS before', numeric: true, mobileHidden: true, render: r => formatMetric('roas', r.before.roas), sortValue: r => r.before.roas, csv: r => r.before.roas?.toFixed(2) ?? '' },
    { key: 'roas_after', label: 'ROAS after', numeric: true, render: r => roasAfter(r.after.roas, r.before.roas), sortValue: r => r.after.roas, csv: r => r.after.roas?.toFixed(2) ?? '' },
    { key: 'cost', label: phone ? 'Cost' : 'Period cost', numeric: true, render: r => formatMetric('cost', r.cost), sortValue: r => r.cost, csv: r => r.cost.toFixed(2) },
    { key: 'conversions_value', label: 'Period revenue', numeric: true, mobileHidden: true, render: r => formatMetric('conversions_value', r.conversions_value), sortValue: r => r.conversions_value, csv: r => r.conversions_value.toFixed(2) },
  ];

  const filterText = cell
    ? cell.from === cell.to ? `${labelName(cell.from)} at start and end, switched in between` : `${labelName(cell.from)} to ${labelName(cell.to)}`
    : 'all products that switched';

  return (
    <Card
      heading={(
        // flex-1: the column icon stays beside the heading on phones.
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">Transitions</h2>
          </div>
          <p className="mt-0.5 text-sm text-muted">
            First label in the period against the last, {fmtNumber(products)} products. {fmtNumber(view.movers_count)} switched at least once. Click a cell to filter the list below.
          </p>
        </div>
      )}>
      <div className="overflow-x-auto">
        <table className="transition-matrix">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-muted max-sm:!px-0.5">from \ to</th>
              {labels.map(to => <th key={to}><BucketChip label={to} phoneShort /></th>)}
            </tr>
          </thead>
          <tbody>
            {labels.map(from => (
              <tr key={from}>
                <th className="text-left max-sm:!px-0.5"><BucketChip label={from} phoneShort /></th>
                {labels.map(to => {
                  const c = cells.find(x => x.from === from && x.to === to);
                  const active = cell?.from === from && cell?.to === to;
                  const diagonal = from === to;
                  const clickable = !!c && c.moved > 0;
                  return (
                    <td key={to} className="p-0 align-middle">
                      {/* Same fixed size for every cell, empty or not. Phones: narrower
                          cells and only the number under the count, explained below the matrix. */}
                      <button type="button" disabled={!clickable} data-active={active} data-diagonal={diagonal}
                        className="transition-cell num box-border h-[3.25rem] w-[6.5rem] shrink-0 max-sm:h-12 max-sm:w-[3.75rem]" onClick={() => setCell(active ? null : { from, to })}
                        style={c && !diagonal ? { background: `color-mix(in srgb, ${LABEL_COLOR[to] || 'var(--gray-300)'} ${Math.round(6 + (c.moved / maxMoved) * 22)}%, var(--paper))` } : undefined}
                        title={c ? `${fmtNumber(c.count)} products, ${formatMetric('cost', c.cost)} cost${diagonal ? `, of which ${fmtNumber(c.moved)} switched in between` : ''}` : undefined}>
                        <span className="block font-medium leading-tight">{c ? fmtNumber(c.count) : '-'}</span>
                        <span className="block text-[11px] leading-tight text-muted">{c ? <>{fmtNumber(c.moved)}<span className="max-sm:hidden"> switched</span></> : '\u00a0'}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted sm:hidden">Large number: products in the cell. Small number: of which switched.</p>
      <div className="mb-2 mt-5 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Movers</span>
        <span className="text-muted">{filterText}, {fmtNumber(rows.length)} products, sorted by cost. Before and after = the label period before and from the last switch.</span>
        {cell && <button type="button" className="text-xs underline" onClick={() => setCell(null)}>clear filter</button>}
      </div>
      {rows.length === 0
        ? <p className="text-sm text-muted">No products that switched in this cell.</p>
        : <DataTable rows={rows} columns={columns} rowKey={r => r.id} defaultSort={{ key: 'cost', direction: 'desc' }} csvName={`${slug}-movers`} maxRows={20}
            onRowClick={r => panel.setOpenId(r.id)} selectedKey={panel.openId} />}
      <Panel list={list} state={panel} />
    </Card>
  );
}

// --- 5. label stability ----------------------------------------------------------

const STABILITY_INFO = 'How often products switch label in the selected period (label per day, days with impressions only). Days in a label = calendar days from the first day in a label to the day before the next switch, only for labels that ended in the period. Per week: the number of switches and the share of products with impressions that switched that week.';
const SWITCH_NAMES = ['No switch', '1 switch', '2 switches', '3 or more'];

function StatBlock({ label, value, sub, className = '' }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={`rounded-[10px] border border-line px-3.5 py-3 ${className}`}>
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 text-lg font-semibold tracking-tight">{value}</div>
      {sub && <div className="num mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function LabelStability({ view, slug }: { view: BucketHistoryView; slug: string }) {
  const { summary, weeks } = view.stability;
  const phone = useIsPhone();
  // Products with three or more switches: the flip-floppers, most switches first.
  const frequent = useMemo(() => view.movers.filter(m => m.path.length - 1 >= 3)
    .sort((a, b) => b.path.length - a.path.length || b.cost - a.cost), [view.movers]);
  const list = useMemo<PanelProduct[]>(() => frequent.map(m => infoFor(view, m.id)), [frequent, view]);
  const panel = usePanel(list);
  const share = (n: number) => (summary.products > 0 ? fmtPercent(n / summary.products, 0) : '-');

  const columns: Column<Mover>[] = [
    { key: 'title', label: 'Product', render: r => <TitleCell row={infoFor(view, r.id)} />, sortValue: r => infoFor(view, r.id).title, csv: r => infoFor(view, r.id).title },
    { key: 'switches', label: 'Switches', numeric: true, render: r => fmtNumber(r.path.length - 1), sortValue: r => r.path.length - 1, csv: r => r.path.length - 1 },
    { key: 'path', label: 'Labels', mobileHidden: true, render: r => <Path path={r.path} direction={r.direction} />, sortValue: r => r.path.join(''), csv: r => r.path.map(labelName).join(' > ') },
    { key: 'strip', label: 'Per day', mobileHidden: true, render: r => <MiniStrip strip={r.strip} />, csv: r => r.strip },
    { key: 'cost', label: phone ? 'Cost' : 'Period cost', numeric: true, render: r => formatMetric('cost', r.cost), sortValue: r => r.cost, csv: r => r.cost.toFixed(2) },
    { key: 'roas', label: 'Period ROAS', numeric: true, mobileHidden: true, render: r => formatMetric('roas', r.cost > 0 ? r.conversions_value / r.cost : null), sortValue: r => (r.cost > 0 ? r.conversions_value / r.cost : null), csv: r => (r.cost > 0 ? (r.conversions_value / r.cost).toFixed(2) : '') },
  ];

  return (
    <Card
      heading={(
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-base font-semibold tracking-tight">Label stability</h2>
          <InfoTip label="Label stability" text={STABILITY_INFO} />
          <span className="text-sm text-muted">{fmtNumber(summary.products)} products in the period</span>
        </div>
      )}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {summary.bySwitches.map(b => (
          <StatBlock key={b.switches} label={SWITCH_NAMES[b.switches]} value={fmtNumber(b.products)} sub={`${share(b.products)} of products, ${formatMetric('cost', b.cost)} cost`} />
        ))}
        {/* Below md the fifth block spans both columns instead of sitting alone. */}
        <StatBlock className="max-md:col-span-2" label="Days in a label" value={summary.medianRunDays === null ? '-' : fmtNumber(summary.medianRunDays)}
          sub={summary.meanRunDays === null ? 'no completed labels' : `median; average ${fmtNumber(summary.meanRunDays, 1)}`} />
      </div>
      {weeks.length > 1 && (
        <div className="mt-5">
          <h3 className="mb-1 text-sm font-semibold">Switches per week</h3>
          <TrendChart data={weeks as unknown as Record<string, unknown>[]} grain="week" height={220} series={[
            { key: 'switches', metric: 'impressions', label: 'Switches', color: 'var(--series-1)', type: 'bar', axis: 'left', muted: true },
            { key: 'share', metric: 'ctr', label: 'Share of products that switched', color: 'var(--series-2)', type: 'line', axis: 'right' },
          ]} />
        </div>
      )}
      <div className="mb-2 mt-5 flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-medium">Switches often</span>
        <span className="text-muted">{fmtNumber(frequent.length)} products with three or more switches, most switches first.</span>
      </div>
      {frequent.length === 0
        ? <p className="text-sm text-muted">No products with three or more switches in this period.</p>
        : <DataTable rows={frequent} columns={columns} rowKey={r => r.id} csvName={`${slug}-switches-often`} maxRows={15}
            onRowClick={r => panel.setOpenId(r.id)} selectedKey={panel.openId} />}
      <Panel list={list} state={panel} />
    </Card>
  );
}
