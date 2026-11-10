'use client';

// Metric tree: the ecommerce metric tree used to find the
// binding constraint, on the campaign facts of the chosen period
// and comparison. Values, comparison and change per node; no constraint is
// marked (the arrows locate a shortfall, they do not prove its cause). The
// top-bar filters apply, so "Exclude brand" gives the Generic tree.
import { useMemo } from 'react';
import { useAccountGoals } from '@/hooks/useAccountGoals';
import { useSearchParams } from 'next/navigation';
import { Card, Notice } from '@/components/Card';
import { TreeSkeleton } from '@/components/PageSkeletons';
import { InfoTip } from '@/components/Badges';
import { useFilterOptions } from '@/components/FilterOptionsContext';
import { useGroupedReport } from '@/hooks/useGroupedReport';
import { Filters, useScope } from '@/components/ScopeContext';
import { CampaignOption, facets, narrowsCampaigns, networkGroups, selectedGroup } from '@/lib/filters';
import { periodGoalViews } from '@/lib/goalsShaping';
import { daysBetween, sumRows } from '@/lib/metrics';
import { buildMetricTree, revenueBridge, roasBridge } from '@/lib/metricTree';
import { byPeriod } from '@/lib/reportShaping';
import { GoalLayer, MetricTree } from '@/components/pages/metric-tree/MetricTree';

const TREE_INFO = 'From top to bottom: before the click (impression share and impressions), the click (CTR, clicks, cost) and after the click (conversion rate, purchases, AOV, revenue). Each calculation is in the info icon of its block. Each block shows the value, with the change and the comparison period below it; the ratio between two blocks is on the line. The tree shows where an outcome shifts, not why: the biggest drop is not automatically the limiting factor. Brand is no benchmark for Generic: turn on "Exclude brand" in the campaign filter for the Generic tree.';

// Quick filters: network as a group (Search, Shopping, Display)
// and one product category, so a shift in the mix between networks or
// categories does not read as a change in a rate. They write the same URL
// filters as the top bar and narrow each other the same way (linked filters).
function QuickFilters({ campaigns, networks, categories, filters, setFilters }: {
  campaigns: CampaignOption[]; networks: string[]; categories: string[]; filters: Filters; setFilters: (f: Partial<Filters>) => void;
}) {
  const facet = facets(campaigns, filters);
  const groups = networkGroups(networks);
  const group = selectedGroup(filters.networks, groups);
  const category = filters.categories.length === 1 ? filters.categories[0] : filters.categories.length ? '*' : '';
  const categoriesAvailable = categories.filter(c => facet.categories.has(c) || filters.categories.includes(c));
  if (groups.length < 2 && categories.length < 2) return null;
  return (
    <div className="tree-toolbar">
      {/* Phones: the eyebrow and the hint wrap around the segmented control. */}
      {groups.length > 1 && (
        <div className="flex items-center gap-2 max-lg:flex-wrap">
          <span className="eyebrow">Network</span>
          <div className="segmented" role="group" aria-label="Network">
            <button type="button" aria-pressed={group === ''} onClick={() => setFilters({ networks: [] })}>All</button>
            {groups.map(g => (
              <button key={g.label} type="button" aria-pressed={group === g.label} disabled={!g.networks.some(n => facet.networks.has(n)) && group !== g.label}
                onClick={() => setFilters({ networks: group === g.label ? [] : g.networks })}>{g.label}</button>
            ))}
          </div>
          {group === null && <span className="text-xs text-muted">customised in the filter bar</span>}
        </div>
      )}
      {categories.length > 1 && (
        <label className="flex items-center gap-2">
          <span className="eyebrow">Category</span>
          <select className="btn-chip" data-active={!!category} value={category} style={{ paddingRight: '1.6rem' }}
            onChange={e => setFilters({ categories: e.target.value ? [e.target.value] : [] })}>
            <option value="">All categories</option>
            {category === '*' && <option value="*" disabled>{filters.categories.length} categories (filter bar)</option>}
            {categoriesAvailable.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

export default function MetricTreePage() {
  const { data, view, error, loading, lagDays } = useGroupedReport();
  const { platform, range, compareRange, filters, setFilters } = useScope();
  const options = useFilterOptions();
  const params = useSearchParams();
  const tree = useMemo(() => (view ? buildMetricTree(view.rows, view.compareLabel ? view.compareRows : null) : null), [view]);
  // The change of both goal metrics split over their factors, on the whole period like
  // the tree itself: the LAG badge in the header covers the lag days.
  const bridges = useMemo(() => {
    if (!view || !view.compareLabel || !view.compareRows.length) return { revenue: null, roas: null };
    const cur = sumRows(view.rows);
    const prev = sumRows(view.compareRows);
    const days = compareRange ? { current: daysBetween(range.start, range.end), previous: daysBetween(compareRange.start, compareRange.end) } : undefined;
    return { revenue: revenueBridge(cur, prev, days), roas: roasBridge(cur, prev) };
  }, [view, range, compareRange]);
  // Goals as on the Overview: one account, Brand included, complete days only.
  // Goals are Google Ads goals.
  const goals = useAccountGoals(data && data.accounts.length === 1 && platform === 'google' ? data.accounts[0].label : null);
  const goal = useMemo<GoalLayer | null>(() => {
    if (!view || !goals || narrowsCampaigns(filters)) return null;
    const views = periodGoalViews(byPeriod(view.rows), byPeriod(view.compareRows), view.grain, range, lagDays, goals, undefined, compareRange?.start);
    const query = params.toString();
    return views ? { views, overviewHref: query ? `/?${query}` : '/' } : null;
  }, [goals, view, filters, range, compareRange, lagDays, params]);

  if (error) return <Notice tone="bad">Report could not be loaded: {error}</Notice>;
  if (loading && !view) return <TreeSkeleton />;
  if (!view || !tree) return null;
  if (view.rows.length === 0) return <Card><Notice tone="warn">No data for this period yet.</Notice></Card>;


  return (
    <div className="space-y-[var(--page-gap)]">
      <Card
        heading={(
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-base font-semibold tracking-tight">Metric tree</h2>
              <InfoTip label="Metric tree" text={TREE_INFO} />
              {tree.hasCompare && <span className="text-sm text-muted">vs {view.compareLabel}</span>}
            </div>
          </div>
        )}>
        <QuickFilters campaigns={options.campaigns} networks={options.networks} categories={options.categories || []} filters={filters} setFilters={setFilters} />
        <MetricTree tree={tree} revenue={bridges.revenue} roas={bridges.roas} goal={goal} />
      </Card>
    </div>
  );
}
