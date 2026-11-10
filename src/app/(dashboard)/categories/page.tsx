'use client';

// Categories: per-category view. By default, campaign categories from the
// campaign names in three cards (Total, Search, Shopping and PMax) with comparison mode and the Trend block per card. An account
// with categoriesFromProductTypes and one campaign uses product type (level 1) instead.
import { LOCALE } from '@/lib/config';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Card, Notice } from '@/components/Card';
import { CategoriesSkeleton } from '@/components/PageSkeletons';
import { useScope } from '@/components/ScopeContext';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useCategoriesReport } from '@/hooks/useCategories';
import { applyFilters, filterOptions } from '@/lib/filters';
import { sumRows } from '@/lib/metrics';
import { activeTarget, lagStart } from '@/lib/reportShaping';
import { categoryRowsFromProducts, categoryTrend, compareLabelFor, productTrendInput, subtypeRowsFor, uniformTargetRoas } from '@/lib/categoriesShaping';
import { CategoryTable, SubtypeDrillDown } from '@/components/pages/categories/CategoryTable';
import { CategoryTrend, TrendMetric } from '@/components/pages/categories/CategoryTrend';
import { CategoryCards } from '@/components/pages/categories/CategoryCards';

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function CategoriesPage() {
  const { scope, range, compare, lagDays, includeLag, filters } = useScope();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const { data, error, loading } = useCategoriesReport();
  const [selected, setSelected] = useState<string | null>(null);
  const [metric, setMetric] = useState<TrendMetric>('conversions_value');

  // The campaign filters only mean something in campaign mode; the product
  // mode publishes no options, so the dropdowns stay hidden there.
  const options = useMemo(() => (data && data.mode === 'campaign' ? filterOptions(data.rows) : null), [data]);
  useSetFilterOptions(options, loading && !data ? 'campaigns' : null);

  // A new label or period invalidates the open drill-down.
  useEffect(() => { setSelected(null); }, [scope, range.start, range.end]);

  const view = useMemo(() => {
    if (!data) return null;
    const account = data.accounts[0];
    const isProduct = data.mode === 'product' && !!data.products;
    const compareLabel = compareLabelFor(compare);
    const freshest = Object.values(data.freshness).filter(Boolean).sort().pop() || null;
    const roasTarget = activeTarget(data.targets, account.id, 'roas', range.end);

    if (!isProduct) {
      return {
        kind: 'campaign' as const, account, freshest, compareLabel,
        rows: applyFilters(data.rows, filters),
        compareRows: applyFilters(data.compareRows, filters),
        grain: data.grain,
        // Targets are blended, so the ROAS line disappears when Brand is excluded.
        roasTarget: filters.excludeBrand ? null : roasTarget,
      };
    }

    const products = data.products!;
    const notes: string[] = [];
    let trendNote: string | undefined;
    const rows = categoryRowsFromProducts(products.rows, products.compareRows, uniformTargetRoas(data.rows));
    const total = sumRows(products.rows);
    const previousTotal = products.compareRows && products.compareRows.length ? sumRows(products.compareRows) : null;
    if (products.coverage === 'monthly') {
      notes.push(`Product data from before ${products.dailyFloor ? longDate(products.dailyFloor) : 'the daily retention period'} only exists per month. This table therefore counts whole calendar months from ${longDate(products.effectiveRange.start)}; the trend is shown per month.`);
      trendNote = 'Per month, because the period falls outside the daily product data.';
    }
    if (compareLabel && !products.compareRows) {
      notes.push(`No comparison (${compareLabel}): that period falls before ${products.dailyFloor ? longDate(products.dailyFloor) : 'the daily retention period'}, and earlier product data only exists per month.`);
    }
    const trend = categoryTrend(productTrendInput(products.rows));
    return {
      kind: 'product' as const, account, freshest, rows, total, previousTotal, notes, trend, trendNote,
      trendGrain: products.grain,
      lagFrom: includeLag ? lagStart(trend.points.map(p => p.period), lagDays, products.grain) : null,
      roasTarget,
      options: { compareLabel: products.compareRows ? compareLabel : '', showImpressionShare: false, showTargetRoas: isAdmin },
      drill: selected ? subtypeRowsFor(products.rows, products.compareRows, selected) : null,
    };
  }, [data, compare, includeLag, lagDays, range.end, isAdmin, selected, filters]);

  useSetFreshness(view?.freshest ?? null);

  const empty = !!view && view.rows.length === 0;

  return (
    <div className="space-y-[var(--page-gap)]">
      {error && <Notice tone="bad">Report could not be loaded: {error}</Notice>}
      {loading && !data && <CategoriesSkeleton />}
      {view && empty && <Card><Notice tone="warn">No data for this period yet.</Notice></Card>}
      {view && !empty && view.kind === 'campaign' && (
        <CategoryCards rows={view.rows} compareRows={view.compareRows} grain={view.grain} lagDays={lagDays} includeLag={includeLag}
          compareLabel={view.compareLabel} roasTarget={view.roasTarget} showTargetRoas={isAdmin} selected={selected} onSelect={setSelected} />
      )}
      {view && !empty && view.kind === 'product' && (
        <>
          <CategoryTable rows={view.rows} total={view.total} previousTotal={view.previousTotal} isProduct
            selected={selected} onSelect={setSelected} options={view.options} notes={view.notes} />
          {view.drill && selected && (
            <SubtypeDrillDown category={selected} rows={view.drill} options={view.options} onClose={() => setSelected(null)} />
          )}
          <CategoryTrend names={view.trend.names} points={view.trend.points} grain={view.trendGrain} metric={metric} onMetric={setMetric}
            lagFrom={view.lagFrom} roasTarget={view.roasTarget} isProduct note={view.trendNote} />
        </>
      )}
    </div>
  );
}
