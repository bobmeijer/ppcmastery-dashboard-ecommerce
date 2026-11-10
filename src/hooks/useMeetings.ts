'use client';

import { useEffect, useState } from 'react';
import { useScope } from '@/components/ScopeContext';
import type { CommunicationsReport } from '@/lib/meetingsShaping';

// Same shape as useCampaignReport; communication is not period-bound, only scoped.
export function useMeetings() {
  const { scope } = useScope();
  const [data, setData] = useState<CommunicationsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/report/meetings?${new URLSearchParams({ scope }).toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as CommunicationsReport;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  return { data, error, loading };
}
