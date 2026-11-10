'use client';

// Quality Score: impression-weighted Quality Score and its
// three components (expected CTR, ad relevance, landing page experience) for
// the Search keywords, from the daily history Google keeps per keyword. Tiles,
// trend and distribution side by side, component bars, fix list (where to start),
// then campaigns / ad groups (one card) and keywords sorted by cost,
// so low scores with money behind them surface first. Top-bar filters apply
// (on the server, see src/app/api/report/quality).
import { useMemo } from 'react';
import { Card, Notice } from '@/components/Card';
import { QualitySkeleton } from '@/components/PageSkeletons';
import { useScope } from '@/components/ScopeContext';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { useQuality } from '@/hooks/useQuality';
import { compareLabelFor } from '@/hooks/useGroupedReport';
import { ComponentBars, FixList, GroupsCard, KeywordTable, QualityDistribution, QualityTiles, QualityTrend } from '@/components/pages/quality/QualityParts';
import { bindingComponent } from '@/lib/qualityShaping';

export default function QualityScorePage() {
  const { scope, compare } = useScope();
  const { data, error, loading } = useQuality();
  useSetFreshness(data?.latest ?? null);
  const options = useMemo(() => (data ? data.options : null), [data]);
  useSetFilterOptions(options, loading && !data ? 'campaigns' : null);

  if (error) return <Notice tone="bad">Report could not be loaded: {error}</Notice>;
  if (loading && !data) return <QualitySkeleton />;
  if (!data) return null;
  const r = data.report;
  if (r.current.impressions === 0) {
    return <Card><Notice tone="warn">No Search keywords with impressions in this period. Shopping and PMax have no Quality Score.</Notice></Card>;
  }

  // Order: how big the problem is and how it developed, which
  // component binds, where to fix it (opens on the binding component), then the detail.
  const binding = bindingComponent(r.current);
  return (
    <div className="space-y-[var(--page-gap)]">
      <QualityTiles current={r.current} previous={r.previous} compareLabel={compareLabelFor(compare)} />
      <div className="grid gap-[var(--page-gap)] lg:grid-cols-2">
        <QualityTrend points={r.trend} grain={r.grain} />
        <QualityDistribution bars={r.distribution} />
      </div>
      <ComponentBars current={r.current} previous={r.previous} compareLabel={compareLabelFor(compare)} />
      <FixList key={`${scope}-${binding}`} rows={r.fixes} slug={scope} binding={binding} />
      <GroupsCard campaigns={r.campaigns} adGroups={r.adGroups} slug={scope} />
      <KeywordTable rows={r.keywords} slug={scope} />
    </div>
  );
}
