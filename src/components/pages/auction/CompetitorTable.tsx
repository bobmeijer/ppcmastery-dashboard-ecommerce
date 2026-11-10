'use client';

import { Column, DataTable } from '@/components/DataTable';
import { useIsPhone } from '@/hooks/useIsMobile';
import { fmtNumber, fmtPercent } from '@/lib/metrics';
import { AuctionNetwork, AuctionRow, fmtShare, onWatchlist } from '@/lib/auctionShaping';

interface Props {
  network: AuctionNetwork;
  own: AuctionRow | null;
  ownLabel: string;
  competitors: AuctionRow[];
  previous: Map<string, AuctionRow> | null;   // comparison period, by competitor
  compareLabel: string;
  colors: Record<string, string>;
  watchlist: string[];
  csvName: string;
}

const pct = (v: number | null) => fmtPercent(v, 1);

// Change in impression share in points; capped values ("< 10%") have no reliable change.
function IsDelta({ now, before }: { now: AuctionRow; before: AuctionRow | undefined }) {
  if (!before) return <span className="text-xs text-subtle">new</span>;
  if (now.is_capped || before.is_capped || now.impression_share === null || before.impression_share === null) return <span className="text-xs text-subtle">-</span>;
  const d = (now.impression_share - before.impression_share) * 100;
  return <span className="num text-xs text-muted">{d >= 0 ? '+' : ''}{fmtNumber(d, 1)} pt</span>;
}

// Own row pinned above the sortable table; Shopping has no position metrics, so those columns drop.
export function CompetitorTable({ network, own, ownLabel, competitors, previous, compareLabel, colors, watchlist, csvName }: Props) {
  const search = network === 'Search';
  const phone = useIsPhone();
  const columns: Column<AuctionRow>[] = [
    {
      key: 'competitor', label: search ? 'Domain' : 'Shop',
      render: r => (
        <span className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[r.competitor] || 'var(--gray-300)' }} />
          <span className="min-w-0 truncate" title={r.competitor}>{r.competitor}</span>
          {onWatchlist(r.competitor, watchlist) && <span className="text-[10px] uppercase tracking-wide text-muted" title="On the watchlist">wl</span>}
        </span>
      ),
      sortValue: r => r.competitor, csv: r => r.competitor,
    },
    { key: 'impression_share', label: 'IS', numeric: true, render: r => fmtShare(r.impression_share, r.is_capped), sortValue: r => r.impression_share, csv: r => r.is_capped ? '<0.10' : r.impression_share },
    ...(previous ? [{
      // Phones: short label so domain, IS, change and overlap fit one screen.
      key: 'is_delta', label: phone ? 'Change' : `IS vs ${compareLabel}`, numeric: true,
      render: (r: AuctionRow) => <IsDelta now={r} before={previous.get(r.competitor)} />,
      sortValue: (r: AuctionRow) => {
        const b = previous.get(r.competitor);
        return b && r.impression_share !== null && b.impression_share !== null ? r.impression_share - b.impression_share : null;
      },
    }] : []),
    { key: 'overlap_rate', label: 'Overlap', numeric: true, render: r => pct(r.overlap_rate), sortValue: r => r.overlap_rate, csv: r => r.overlap_rate },
    ...(search ? [
      { key: 'position_above_rate', label: 'Position above', numeric: true, mobileHidden: true, render: (r: AuctionRow) => pct(r.position_above_rate), sortValue: (r: AuctionRow) => r.position_above_rate, csv: (r: AuctionRow) => r.position_above_rate },
      { key: 'top_of_page_rate', label: 'Top of page', numeric: true, mobileHidden: true, render: (r: AuctionRow) => pct(r.top_of_page_rate), sortValue: (r: AuctionRow) => r.top_of_page_rate, csv: (r: AuctionRow) => r.top_of_page_rate },
      { key: 'abs_top_rate', label: 'Abs. top', numeric: true, mobileHidden: true, render: (r: AuctionRow) => pct(r.abs_top_rate), sortValue: (r: AuctionRow) => r.abs_top_rate, csv: (r: AuctionRow) => r.abs_top_rate },
    ] : []),
    { key: 'outranking_share', label: 'Outranking', numeric: true, mobileHidden: true, render: r => pct(r.outranking_share), sortValue: r => r.outranking_share, csv: r => r.outranking_share },
  ];

  const ownBefore = own && previous ? previous.get(own.competitor) : undefined;
  const ownCells = own ? [
    { label: 'IS', value: fmtShare(own.impression_share, own.is_capped) },
    ...(search ? [
      { label: 'Top of page', value: pct(own.top_of_page_rate) },
      { label: 'Abs. top', value: pct(own.abs_top_rate) },
    ] : []),
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded border border-line bg-paper-alt px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'var(--series-1)' }} />
          {ownLabel}
        </span>
        {own ? ownCells.map(c => (
          <span key={c.label} className="text-sm text-muted">{c.label} <span className="num font-medium text-ink">{c.value}</span></span>
        )) : <span className="text-sm text-muted">Own row is missing for this period.</span>}
        {own && previous && <span className="text-sm text-muted">IS vs {compareLabel} <IsDelta now={own} before={ownBefore} /></span>}
      </div>
      <DataTable rows={competitors} columns={columns} rowKey={r => r.competitor} defaultSort={{ key: 'overlap_rate', direction: 'desc' }} csvName={csvName} maxRows={12} />
    </div>
  );
}
