'use client';

import { useEffect, useState } from 'react';
import type { FactRow } from '@/lib/metrics';
import type { RoleRow, TargetRow } from '@/lib/reports';
import { useScope } from '@/components/ScopeContext';

export interface ReportAccount { id: string; label: string; display_name: string; lag_days: number }

export interface CampaignReport {
  scope: string;
  accounts: ReportAccount[];
  range: { start: string; end: string };
  compareRange: { start: string; end: string } | null;
  grain: 'day' | 'week' | 'month';
  rows: FactRow[];
  compareRows: FactRow[];
  roles: RoleRow[];
  targets: TargetRow[];
  freshness: Record<string, string | null>;
  role: 'admin' | 'client';
}

// A fixed range without comparison: Trends uses it for the lead-in periods the
// rolling average needs before the selected period starts.
export function useRangeReport(range: { start: string; end: string } | null, grain?: 'day' | 'week' | 'month') {
  const { scope, platform } = useScope();
  const [data, setData] = useState<CampaignReport | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!range) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ scope, start: range.start, end: range.end, compare: 'none' });
    if (platform === 'microsoft') params.set('platform', platform);
    if (grain) params.set('grain', grain);
    fetch(`/api/report/campaigns?${params.toString()}`)
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body as CampaignReport; })
      .then(body => { if (!cancelled) setData(body); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, platform, range?.start, range?.end, grain]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading };
}

export function useCampaignReport(grain?: 'day' | 'week' | 'month') {
  const { scope, platform, range, compare, compareRange } = useScope();
  const [data, setData] = useState<CampaignReport | null>(null);
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
    fetch(`/api/report/campaigns?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as CampaignReport;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, platform, range.start, range.end, compare, compareRange?.start, compareRange?.end, grain]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading };
}
