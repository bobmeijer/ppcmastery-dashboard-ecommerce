'use client';

// Overview, cockpit layout (round 1), monochrome language (round 2).
// Order: goal meters, KPI tiles, by network, by category.
// No trend chart here (round 8); small multiples live on Trends.
import { useMemo } from 'react';
import { Notice } from '@/components/Card';
import { OverviewSkeleton } from '@/components/PageSkeletons';
import { useScope } from '@/components/ScopeContext';
import { useCampaignReport } from '@/hooks/useReport';
import { KpiTiles } from '@/components/overview/KpiTiles';
import { BreakdownTables } from '@/components/overview/BreakdownTables';
import { GoalMeters } from '@/components/GoalMeters';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { applyFilters, filterOptions, narrowsCampaigns } from '@/lib/filters';
import { useOverviewView } from '@/components/overview/shared';

export default function OverviewPage() {
  const { platform, range, compare, lagDays, includeLag, filters } = useScope();
  const { data, error, loading } = useCampaignReport();
  // Filters apply client-side; the dropdown options come from the unfiltered period.
  const options = useMemo(() => (data ? filterOptions(data.rows) : null), [data]);
  useSetFilterOptions(options, loading && !data ? 'campaigns' : null);
  const filtered = useMemo(() => (data ? { ...data, rows: applyFilters(data.rows, filters), compareRows: applyFilters(data.compareRows, filters) } : null), [data, filters]);
  const view = useOverviewView(filtered, range.end, lagDays, includeLag, compare);
  useSetFreshness(view?.freshest ?? null);

  return (
    <>
      {error && <Notice tone="bad">Report could not be loaded: {error}</Notice>}
      {loading && !data && <OverviewSkeleton goals={platform === 'google'} />}
      {view && filtered && (
        <div className="reveal-stagger space-y-[var(--page-gap)]">
          {platform === 'google' && <GoalMeters periods={view.periods} comparePeriods={view.comparePeriods} grain={view.grain} range={range} lagDays={lagDays} excludeBrand={filters.excludeBrand} filtered={narrowsCampaigns(filters)} compareLabel={view.compareLabel} />}
          <KpiTiles view={view} variant="A" />
          <BreakdownTables view={view} variant="A" />
        </div>
      )}
      {view && filtered && filtered.rows.length === 0 && <Notice tone="warn">{data && data.rows.length > 0 ? 'No campaigns within the selected filters.' : 'No data for this period yet.'}</Notice>}
    </>
  );
}

