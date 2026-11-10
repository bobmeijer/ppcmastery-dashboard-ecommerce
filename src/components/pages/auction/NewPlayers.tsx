'use client';

import { Notice } from '@/components/Card';
import { fmtPercent } from '@/lib/metrics';
import { fmtShare, NewPlayer, onWatchlist } from '@/lib/auctionShaping';

interface Props {
  players: NewPlayer[];
  hasCompare: boolean;
  compareLabel: string;
  watchlist: string[];
}

// Competitors in this period that did not appear at all in the comparison period.
export function NewPlayers({ players, hasCompare, compareLabel, watchlist }: Props) {
  if (!hasCompare) return <Notice>Choose a comparison period to see new players.</Notice>;
  if (players.length === 0) return <Notice>No new players: every competitor in this period also took part in the {compareLabel}.</Notice>;
  return (
    <ul className="divide-y divide-line">
      {players.map(p => (
        <li key={p.competitor} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium" title={p.competitor}>{p.competitor}</span>
            {onWatchlist(p.competitor, watchlist) && <span className="text-[10px] uppercase tracking-wide text-muted" title="On the watchlist">wl</span>}
          </span>
          <span className="num flex gap-4 text-muted">
            <span>IS <span className="text-ink">{fmtShare(p.impression_share, p.is_capped)}</span></span>
            <span>overlap <span className="text-ink">{fmtPercent(p.overlap_rate, 1)}</span></span>
          </span>
        </li>
      ))}
    </ul>
  );
}
