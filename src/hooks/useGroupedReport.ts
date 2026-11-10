'use client';

// The campaign report with the top-bar filters applied, for the grouped pages
// (Networks, Campaigns). Publishes the filter options and the freshness like
// Trends does, so the pages only shape rows.
import { useMemo } from 'react';
import { useScope } from '@/components/ScopeContext';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useCampaignReport } from './useReport';
import { applyFilters, filterOptions } from '@/lib/filters';
import { FactRow } from '@/lib/metrics';
import { activeTarget } from '@/lib/reportShaping';
import type { TargetRow } from '@/lib/reports';

export interface GroupedView {
  rows: FactRow[];
  compareRows: FactRow[];
  grain: 'day' | 'week' | 'month';
  compareLabel: string;          // '' when the period control says no comparison
  roasTarget: TargetRow | null;  // null when Brand is excluded (targets are blended)
  freshest: string | null;
}

export const compareLabelFor = (compare: string) => (compare === 'year' ? 'last year' : compare === 'none' ? '' : 'previous period');

export function useGroupedReport() {
  const { range, compare, lagDays, includeLag, filters } = useScope();
  const { data, error, loading } = useCampaignReport();
  const options = useMemo(() => (data ? filterOptions(data.rows) : null), [data]);
  useSetFilterOptions(options, loading && !data ? 'campaigns' : null);

  const view = useMemo<GroupedView | null>(() => {
    if (!data) return null;
    const account = data.accounts.length === 1 ? data.accounts[0].id : null;
    return {
      rows: applyFilters(data.rows, filters),
      compareRows: applyFilters(data.compareRows, filters),
      grain: data.grain,
      compareLabel: compareLabelFor(compare),
      roasTarget: account && !filters.excludeBrand ? activeTarget(data.targets, account, 'roas', range.end) : null,
      freshest: Object.values(data.freshness).filter(Boolean).sort().pop() || null,
    };
  }, [data, filters, compare, range.end]);
  useSetFreshness(view?.freshest ?? null);

  return { data, view, error, loading, lagDays, includeLag };
}
