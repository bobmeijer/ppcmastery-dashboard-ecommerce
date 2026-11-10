'use client';

// Countries: NL / BE / Other by user location. Cockpit layout, no own H1 (the top bar carries the title).
import { useMemo, useState } from 'react';
import { Card, Notice } from '@/components/Card';
import { CountriesSkeleton } from '@/components/PageSkeletons';
import { useScope } from '@/components/ScopeContext';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { compareLabelFor } from '@/hooks/useGroupedReport';
import { applyFilters, filterOptions } from '@/lib/filters';
import { useCountries } from '@/hooks/useCountries';
import { formatMetric } from '@/lib/metrics';
import { activeTarget, lagStart, targetLabel } from '@/lib/reportShaping';
import { beVsNlFinding, countryMatrix, countrySummaries, geoChartData, matrixTotals, otherBreakdown, STACK_METRICS, StackMetric } from '@/lib/geoShaping';
import { CountryTile, OtherLine } from '@/components/pages/countries/CountryTiles';
import { GeoChart } from '@/components/pages/countries/GeoChart';
import { CountryMatrix } from '@/components/pages/countries/CountryMatrix';
import { AdminNote } from '@/components/pages/countries/AdminNote';
import { useIsPhone } from '@/hooks/useIsMobile';

export default function CountriesPage() {
  const { range, compare, lagDays, includeLag, filters } = useScope();
  const { data, error, loading } = useCountries();
  const [metric, setMetric] = useState<StackMetric>('conversions_value');
  const phone = useIsPhone();
  // Top-bar filters: options from the unfiltered period, applied client-side like the grouped pages.
  const options = useMemo(() => (data ? filterOptions(data.rows) : null), [data]);
  useSetFilterOptions(options, loading && !data ? 'campaigns' : null);

  const view = useMemo(() => {
    if (!data) return null;
    const rows = applyFilters(data.rows, filters);
    const compareRows = applyFilters(data.compareRows, filters);
    const summaries = countrySummaries(rows, compareRows);
    const periods = [...new Set(rows.map(r => r.period))].sort();
    const single = data.accounts.length === 1 ? data.accounts[0].id : null;
    const hasOther = summaries.Other.cost > 0 || summaries.Other.impressions > 0;
    return {
      summaries,
      otherLines: otherBreakdown(rows),
      hasOther,
      chart: geoChartData(rows, metric),
      byCategory: countryMatrix(rows, 'category', compareRows),
      byNetwork: countryMatrix(rows, 'network', compareRows),
      totals: matrixTotals(rows, compareRows),
      // The target is blended incl. Brand, so it goes when Brand is excluded (as on the grouped pages).
      roasTarget: single && !filters.excludeBrand ? activeTarget(data.targets, single, 'roas', range.end) : null,
      empty: rows.length === 0,
      lagFrom: includeLag ? lagStart(periods, lagDays, data.grain) : null,
      freshest: Object.values(data.freshness).filter(Boolean).sort().pop() || null,
      // Admin-only line from the same filtered rows as the tiles.
      finding: data.role === 'admin' ? beVsNlFinding(summaries.NL, summaries.BE) : null,
    };
  }, [data, filters, metric, range.end, lagDays, includeLag]);
  useSetFreshness(view?.freshest ?? null);

  const compareLabel = compare === 'year' ? 'vs last year' : compare === 'none' ? '' : 'vs previous period';
  const metricLabel = STACK_METRICS.find(m => m.key === metric)!.label;
  const tableCompareLabel = compareLabelFor(compare);
  const empty = !!view && view.empty;

  return (
    <div className="space-y-[var(--page-gap)]">
      {error && <Notice tone="bad">Report could not be loaded: {error}</Notice>}
      {loading && !data && <CountriesSkeleton />}
      {empty && <Card><Notice tone="warn">No country data for this period yet.</Notice></Card>}

      {view && data && !empty && (
        <>
          <section className="space-y-3">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <CountryTile summary={view.summaries.NL} target={view.roasTarget} compareLabel={compareLabel} />
              <CountryTile summary={view.summaries.BE} target={view.roasTarget} compareLabel={compareLabel} />
            </div>
            <OtherLine summary={view.summaries.Other} lines={view.otherLines} />
          </section>

          <Card title={`${metricLabel} by country`} subtitle="Stacked bars per country, ROAS per country as a line on the right axis"
            actions={(
              <div className="flex flex-wrap items-center gap-1">
                {STACK_METRICS.map(m => (
                  <button key={m.key} type="button" className="btn-chip" data-active={metric === m.key} onClick={() => setMetric(m.key)}>{m.label}</button>
                ))}
              </div>
            )}>
            <GeoChart height={phone ? 260 : undefined} data={view.chart} metric={metric} metricLabel={metricLabel} grain={data.grain} lagFrom={view.lagFrom} showOther={view.hasOther}
              target={view.roasTarget ? { value: view.roasTarget.value, label: `ROAS ${targetLabel(view.roasTarget)} ${formatMetric('roas', view.roasTarget.value)}` } : null} />
          </Card>

          {/* grid-cols-1 (minmax(0,1fr)) so a wide matrix scrolls inside its card instead of
              widening the page. */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Country x category" subtitle="Cost per cell, ROAS below. Category derived from the campaign names.">
              <CountryMatrix rows={view.byCategory} footer={view.totals} nameLabel="Category" storageKey="countries-by-category" compareLabel={tableCompareLabel} showOther={view.hasOther} maxRows={12} />
            </Card>
            <Card title="Country x network" subtitle="Cost per cell, ROAS below.">
              <CountryMatrix rows={view.byNetwork} footer={view.totals} nameLabel="Network" storageKey="countries-by-network" compareLabel={tableCompareLabel} showOther={view.hasOther} sortByCost={false} />
            </Card>
          </div>

          <AdminNote finding={view.finding} />
        </>
      )}
    </div>
  );
}
