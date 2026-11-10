'use client';

import { useEffect, useState } from 'react';
import { useScope } from '@/components/ScopeContext';
import type { ReportAccount } from '@/hooks/useReport';
import type { CampaignOption } from '@/lib/filters';
import type { QualityReport } from '@/lib/qualityShaping';

export interface QualityResponse {
  scope: string;
  accounts: ReportAccount[];
  range: { start: string; end: string };
  compareRange: { start: string; end: string } | null;
  options: { campaigns: CampaignOption[]; networks: string[] };
  latest: string | null;
  report: QualityReport;
  role: 'admin' | 'client';
}

// The top-bar filters go to the server (the route filters a year of keyword-days there).
export function useQuality() {
  const { scope, platform, range, compareRange, filters } = useScope();
  const [data, setData] = useState<QualityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const campaigns = filters.campaigns.join(',');
  const networks = filters.networks.join(',');
  const categories = filters.categories.join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ scope, start: range.start, end: range.end });
    if (platform === 'microsoft') params.set('platform', platform);
    if (compareRange) { params.set('compareStart', compareRange.start); params.set('compareEnd', compareRange.end); }
    if (campaigns) params.set('campaigns', campaigns);
    if (networks) params.set('networks', networks);
    if (categories) params.set('categories', categories);
    if (filters.excludeBrand) params.set('brand', '0');
    if (filters.status) params.set('status', filters.status);
    fetch(`/api/report/quality?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as QualityResponse;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, platform, range.start, range.end, compareRange?.start, compareRange?.end, campaigns, networks, categories, filters.excludeBrand, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading };
}
