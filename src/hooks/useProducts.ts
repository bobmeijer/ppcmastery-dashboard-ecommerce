'use client';

import { useEffect, useState } from 'react';
import { useScope } from '@/components/ScopeContext';
import type { ReportAccount } from '@/hooks/useReport';
import type { ProductsReportBody } from '@/lib/productsShaping';
import { serializeTypeFilter } from '@/lib/productTypes';

export interface ProductsReport extends ProductsReportBody {
  scope: string;
  accounts: ReportAccount[];
  range: { start: string; end: string };
  freshness: Record<string, string | null>;
  role: 'admin' | 'client';
}

export function useProductsReport() {
  const { scope, platform, range, filters } = useScope();
  const { pt1, pt2 } = serializeTypeFilter(filters.types);
  const [data, setData] = useState<ProductsReport | null>(null);
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
    fetch(`/api/report/products?${params.toString()}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body as ProductsReport;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, platform, range.start, range.end, pt1, pt2]);

  return { data, error, loading };
}
