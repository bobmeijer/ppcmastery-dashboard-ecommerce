'use client';

// Buckets: how the ProductHero buckets (H heroes, S sidekicks, V villains,
// Z zombies) move over time: distribution per label, bucket
// history, what a switch does, and the transitions matrix filtering the
// movers, built from the label each product had per day
// (src/lib/bucketsHistory.ts). Products is the per-product view of the same
// labels; the two pages link to each other. The campaign matrix per category
// and bucket lives on Categories.
import { LOCALE } from '@/lib/config';
import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { pageAvailable } from '@/components/nav';
import { useHrefWith } from '@/components/pageLinks';
import { Card, Notice } from '@/components/Card';
import { BucketsSkeleton } from '@/components/PageSkeletons';
import { useScope } from '@/components/ScopeContext';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { useBuckets } from '@/hooks/useBuckets';
import { BucketHistory, LabelDistribution, LabelStability, SwitchEffects, Transitions } from '@/components/pages/buckets/BucketProducts';

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function BucketsPage() {
  const { scope, range } = useScope();
  const { data, error, loading } = useBuckets();
  // Accounts without buckets do not have this page: go to Products.
  const router = useRouter();
  const hrefWith = useHrefWith();
  const available = pageAvailable('/buckets', scope);
  useEffect(() => { if (!available) router.replace(hrefWith('/products')); }, [available, router, hrefWith]);
  const freshest = useMemo(() => (data ? Object.values(data.freshness).filter(Boolean).sort().pop() || null : null), [data]);
  useSetFreshness(freshest);
  const filterOptions = useMemo(() => (data ? { campaigns: [], networks: [], productTypes: data.history.type_options } : null), [data]);
  useSetFilterOptions(filterOptions, loading && !data ? 'types' : null);

  if (!available) return null;
  if (error) return <Notice tone="bad">Report could not be loaded: {error}</Notice>;
  if (loading && !data) return <BucketsSkeleton />;
  if (!data) return null;

  const history = data.history;
  const name = data.accounts.length === 1 ? data.accounts[0].display_name : scope;
  const clamped = data.productRange.start !== range.start;

  if (!history.labelled) {
    return (
      <Card title="No buckets yet">
        <Notice tone="warn">
          Products in {name} have no ProductHero label in this period (custom_label_2 is empty in the feed).
          This page fills automatically once the labels are in the feed.
        </Notice>
      </Card>
    );
  }

  return (
    <div className="space-y-[var(--page-gap)]">
      {clamped && <p className="text-xs text-muted">Daily product data starts on {shortDate(data.productRange.start)}; the blocks start there.</p>}
      <LabelDistribution view={history} slug={scope} />
      <BucketHistory view={history} />
      <LabelStability view={history} slug={scope} />
      <SwitchEffects view={history} slug={scope} />
      <Transitions view={history} slug={scope} />
    </div>
  );
}
