'use client';

import { moduleEnabled } from '@/lib/config';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useScope } from '@/components/ScopeContext';
import type { ChangeDay } from '@/lib/reports-changes';

export type { ChangeDay, ChangeEventSummary } from '@/lib/reports-changes';

const EMPTY: ChangeDay[] = [];

// Account change history for the current scope (Admin-only). Fetches nothing for
// the client role or while disabled, and then reports an empty list.
export function useChangeEvents(range: { start: string; end: string }, enabled: boolean): { days: ChangeDay[]; loading: boolean } {
  const { scope } = useScope();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const active = enabled && isAdmin && moduleEnabled('changeHistory');
  const [days, setDays] = useState<ChangeDay[]>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active) { setDays(EMPTY); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ scope, start: range.start, end: range.end });
    fetch(`/api/report/changes?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as { days: ChangeDay[] };
      })
      .then(body => { if (!cancelled) setDays(body.days || EMPTY); })
      .catch(() => { if (!cancelled) setDays(EMPTY); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, scope, range.start, range.end]);

  return { days, loading };
}
