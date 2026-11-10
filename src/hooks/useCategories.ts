'use client';

import { useEffect, useState } from 'react';
import type { FactRow } from '@/lib/metrics';
import type { TargetRow } from '@/lib/reports';
import type { ProductTypeReport } from '@/lib/reports-categories';
import { useScope } from '@/components/ScopeContext';
import type { ReportAccount } from './useReport';

export interface CategoriesReport {
  scope: string;
  accounts: ReportAccount[];
  range: { start: string; end: string };
  compareRange: { start: string; end: string } | null;
  grain: 'day' | 'week' | 'month';
  mode: 'campaign' | 'product';
  rows: FactRow[];
  compareRows: FactRow[];
  products: ProductTypeReport | null;
  targets: TargetRow[];
  freshness: Record<string, string | null>;
  role: 'admin' | 'client';
}

export function useCategoriesReport() {
  const { scope, platform, range, compare, compareRange } = useScope();
  const [data, setData] = useState<CategoriesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ scope, start: range.start, end: range.end, compare });
    if (platform === 'microsoft') params.set('platform', platform);
    if (compareRange) { params.set('compareStart', compareRange.start); params.set('compareEnd', compareRange.end); }
    fetch(`/api/report/categories?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as CategoriesReport;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, platform, range.start, range.end, compare, compareRange?.start, compareRange?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading };
}
