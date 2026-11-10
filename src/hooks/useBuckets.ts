'use client';

import { useEffect, useState } from 'react';
import type { BucketHistoryView } from '@/lib/bucketsHistory';
import type { ReportAccount } from '@/hooks/useReport';
import { useScope } from '@/components/ScopeContext';
import { serializeTypeFilter } from '@/lib/productTypes';

export interface BucketsReport {
  scope: string;
  accounts: ReportAccount[];
  range: { start: string; end: string };
  productRange: { start: string; end: string };   // range clamped to the daily product table
  history: BucketHistoryView;                       // product part, filtered on product type (pt1 / pt2)
  freshness: Record<string, string | null>;
  role: 'admin' | 'client';
}

export function useBuckets() {
  const { scope, platform, range, filters } = useScope();
  const { pt1, pt2 } = serializeTypeFilter(filters.types);
  const [data, setData] = useState<BucketsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ scope, start: range.start, end: range.end });
    if (platform === 'microsoft') params.set('platform', platform);
    if (pt1) params.set('pt1', pt1);
    if (pt2) params.set('pt2', pt2);
    fetch(`/api/report/buckets?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as BucketsReport;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, platform, range.start, range.end, pt1, pt2]);

  return { data, error, loading };
}
