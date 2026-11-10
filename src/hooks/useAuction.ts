'use client';

import { useEffect, useState } from 'react';
import type { AuctionGrain, AuctionNetwork, AuctionRow } from '@/lib/auctionShaping';
import type { AuctionCoverage } from '@/lib/reports-auction';
import type { DateRange } from '@/lib/metrics';
import { useScope } from '@/components/ScopeContext';
import type { ReportAccount } from '@/hooks/useReport';

export interface AuctionReport {
  scope: string;
  account: ReportAccount;
  watchlist: string[];
  coverage: AuctionCoverage[];
  categories: Record<AuctionNetwork, string[]>;
  network: AuctionNetwork;
  category: string | null;
  grain: AuctionGrain;
  rows: AuctionRow[];
  totals: AuctionRow[];
  compare_totals: AuctionRow[] | null;
  role: 'admin' | 'client';
}

// One network and category at a time. `range` overrides the top-bar period
// (the "Since 2024" chart view); the comparison period only applies without it.
export function useAuctionReport(params: { network: AuctionNetwork; category: string | null; grain: AuctionGrain; range?: DateRange | null; skip?: boolean }) {
  const { scope, range: scopeRange, compareRange } = useScope();
  const range = params.range ?? scopeRange;
  const compare = params.range ? null : compareRange;
  const [data, setData] = useState<AuctionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = new URLSearchParams({ scope, start: range.start, end: range.end, grain: params.grain, network: params.network });
  if (params.category) query.set('category', params.category);
  if (compare) { query.set('compare_start', compare.start); query.set('compare_end', compare.end); }
  const key = params.skip ? null : query.toString();

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/report/auction?${key}`)
      .then(async response => {
        // A platform error (504 and the like) has no JSON body.
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as AuctionReport;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key]);

  return { data, error, loading };
}
