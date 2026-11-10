'use client';

import { useEffect, useState } from 'react';
import type { TargetRow } from '@/lib/reports';
import type { BeVsNlFinding, GeoRow } from '@/lib/geoShaping';
import { useScope } from '@/components/ScopeContext';
import type { ReportAccount } from './useReport';

export interface GeoReport {
  scope: string;
  accounts: ReportAccount[];
  range: { start: string; end: string };
  compareRange: { start: string; end: string } | null;
  grain: 'day' | 'week' | 'month';
  rows: GeoRow[];
  compareRows: GeoRow[];
  targets: TargetRow[];
  freshness: Record<string, string | null>;
  finding: BeVsNlFinding | null;   // admin only, null for the client role
  role: 'admin' | 'client';
}

export function useCountries(grain?: 'day' | 'week' | 'month') {
  const { scope, platform, range, compare, compareRange } = useScope();
  const [data, setData] = useState<GeoReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ scope, start: range.start, end: range.end, compare });
    if (platform === 'microsoft') params.set('platform', platform);
    if (compareRange) { params.set('compareStart', compareRange.start); params.set('compareEnd', compareRange.end); }
    if (grain) params.set('grain', grain);
    fetch(`/api/report/geo?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as GeoReport;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, platform, range.start, range.end, compare, compareRange?.start, compareRange?.end, grain]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading };
}
