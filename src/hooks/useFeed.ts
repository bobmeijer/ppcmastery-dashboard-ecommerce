'use client';

import { useEffect, useState } from 'react';
import type { FeedSnapshot } from '@/lib/feedShaping';
import { useScope } from '@/components/ScopeContext';

export interface FeedReport {
  scope: string;
  account: { id: string; label: string; display_name: string; lag_days: number; merchant_id: string | null };
  snapshot: FeedSnapshot;
  role: 'admin' | 'client';
}

// The feed status is the latest snapshot per label; the period control does not apply to it.
export function useFeedReport() {
  const { scope } = useScope();
  const [data, setData] = useState<FeedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ scope });
    fetch(`/api/report/feed?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as FeedReport;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  return { data, error, loading };
}
