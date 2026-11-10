'use client';

import { AuctionNetwork, NETWORKS } from '@/lib/auctionShaping';

interface Props {
  network: AuctionNetwork;
  onNetwork: (n: AuctionNetwork) => void;
  categories: string[];
  category: string;
  onCategory: (c: string) => void;
  watchlistSize: number;
  watchlistOnly: boolean;
  onWatchlistOnly: (v: boolean) => void;
}

// Selector row above the cards: network toggle, category chips (biggest first), watch-list filter.
export function AuctionSelectors({ network, onNetwork, categories, category, onCategory, watchlistSize, watchlistOnly, onWatchlistOnly }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Network">
          {NETWORKS.map(n => (
            <button key={n} type="button" role="tab" aria-selected={network === n} className="btn-chip" data-active={network === n} onClick={() => onNetwork(n)}>{n}</button>
          ))}
        </div>
        <span className="hidden h-5 border-l border-line sm:block" />
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Category">
          {categories.map(c => (
            <button key={c} type="button" className="btn-chip" data-active={category === c} onClick={() => onCategory(c)}>{c}</button>
          ))}
          {categories.length === 0 && <span className="text-sm text-muted">No categories for {network} in this period.</span>}
        </div>
      </div>
      {/* min-h-10: a 40px tap row on phones. */}
      <label className="flex items-center gap-2 text-sm text-muted max-sm:min-h-10">
        <input type="checkbox" checked={watchlistOnly} disabled={watchlistSize === 0} onChange={e => onWatchlistOnly(e.target.checked)} />
        Watchlist only ({watchlistSize})
      </label>
    </div>
  );
}
