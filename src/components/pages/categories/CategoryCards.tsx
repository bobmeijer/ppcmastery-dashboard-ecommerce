'use client';

// Campaign category view ("maybe 3 cards; total,
// search, shopping"): Total with the drill-down into campaigns, Search
// (branded and non-branded together), Shopping and PMax. Same columns, same
// comparison mode and the same Trend block as Networks and Campaigns.
import { displayNetwork } from '@/lib/filters';
import { useMemo } from 'react';
import { Card } from '@/components/Card';
import { DataTable, Column } from '@/components/DataTable';
import { GroupCard } from '@/components/pages/shared/GroupCard';
import { CampaignName, metricColumns } from '@/components/pages/shared/metricColumns';
import type { TargetRow } from '@/lib/reports';
import { FactRow, formatMetric } from '@/lib/metrics';
import { CampaignRow, campaignRowsFor, CategoryRow, categoryRowsFromCampaigns } from '@/lib/categoriesShaping';
import { totalRow } from '@/lib/groupedShaping';
import { bucketMatrix } from '@/lib/bucketsShaping';
import { BucketMatrix } from '@/components/pages/buckets/BucketMatrix';

export const SEARCH_NETWORKS = ['Search'];
export const SHOPPING_NETWORKS = ['Shopping', 'PMax'];

const byCategory = (r: FactRow) => r.category;

interface Props {
  rows: FactRow[];
  compareRows: FactRow[];
  grain: 'day' | 'week' | 'month';
  lagDays: number;
  includeLag: boolean;
  compareLabel: string;
  roasTarget: TargetRow | null;
  showTargetRoas: boolean;        // Admin only
  selected: string | null;
  onSelect: (name: string | null) => void;
}

const slice = (rows: FactRow[], networks: string[]) => rows.filter(r => networks.includes(r.network));

const tROAS = <T extends { target_roas: number | null }>(): Column<T> => ({
  key: 'target_roas', label: 'tROAS', numeric: true, mobileHidden: true,
  render: r => (r.target_roas ? <span className="text-muted">{formatMetric('roas', r.target_roas)}</span> : <span className="text-subtle">-</span>),
  sortValue: r => r.target_roas ?? null,
});

const footerFor = (rows: FactRow[], compareRows: FactRow[]): CategoryRow => ({ ...totalRow(rows, compareRows), target_roas: null, items: 0 });

export function CategoryCards({ rows, compareRows, grain, lagDays, includeLag, compareLabel, roasTarget, showTargetRoas, selected, onSelect }: Props) {
  const compare = !!compareLabel;

  const blocks = useMemo(() => {
    const search = { rows: slice(rows, SEARCH_NETWORKS), compareRows: slice(compareRows, SEARCH_NETWORKS) };
    const shopping = { rows: slice(rows, SHOPPING_NETWORKS), compareRows: slice(compareRows, SHOPPING_NETWORKS) };
    return {
      total: { rows: categoryRowsFromCampaigns(rows, compareRows), footer: footerFor(rows, compareRows) },
      search: { ...search, table: categoryRowsFromCampaigns(search.rows, search.compareRows), footer: footerFor(search.rows, search.compareRows) },
      shopping: { ...shopping, table: categoryRowsFromCampaigns(shopping.rows, shopping.compareRows), footer: footerFor(shopping.rows, shopping.compareRows), buckets: bucketMatrix(shopping.rows) },
      drill: selected ? campaignRowsFor(rows, compareRows, selected) : null,
    };
  }, [rows, compareRows, selected]);

  // Phones drop the campaign count: the capped name column would clip it.
  const count = (r: CategoryRow) => (r.items > 0 ? <span className="num ml-1.5 text-xs font-normal text-subtle max-sm:hidden">{r.items} {r.items === 1 ? 'campaign' : 'campaigns'}</span> : null);
  const after = showTargetRoas ? [tROAS<CategoryRow>()] : [];

  const totalColumns = useMemo(() => metricColumns<CategoryRow>('Category', {
    compare, after,
    renderName: r => (r.items === 0 ? r.name : (
      <button type="button" className="text-left font-medium hover:underline max-sm:-my-2.5 max-sm:py-2.5" aria-pressed={selected === r.name}
        style={{ color: selected === r.name ? 'var(--accent)' : 'inherit' }} onClick={() => onSelect(selected === r.name ? null : r.name)}>
        {r.name}{count(r)}
      </button>
    )),
  }), [compare, selected, onSelect, showTargetRoas]); // eslint-disable-line react-hooks/exhaustive-deps
  const plainColumns = useMemo(() => metricColumns<CategoryRow>('Category', {
    compare, after, renderName: r => <span className="font-medium">{r.name}{count(r)}</span>,
  }), [compare, showTargetRoas]); // eslint-disable-line react-hooks/exhaustive-deps
  const drillColumns = useMemo(() => metricColumns<CampaignRow>('Campaign', {
    compare,
    renderName: r => <CampaignName name={r.name} status={r.status} />,
    before: [{ key: 'network', label: 'Network', mobileHidden: true, render: r => displayNetwork(r), sortValue: r => displayNetwork(r) } as Column<CampaignRow>],
    after: showTargetRoas ? [tROAS<CampaignRow>()] : [],
  }), [compare, showTargetRoas]);

  const trend = (facts: FactRow[], keyOf: (r: FactRow) => string) => ({ rows: facts, keyOf, grain, lagDays, includeLag, roasTarget });

  return (
    <>
      <GroupCard title="Total" rows={blocks.total.rows} columns={totalColumns} rowKey={r => r.name} footer={blocks.total.footer}
        storageKey="categories-total" compareLabel={compareLabel} trend={trend(rows, byCategory)} />
      {blocks.drill && selected && (
        <Card title={`Campaigns in ${selected}`} actions={<button type="button" className="btn-chip" onClick={() => onSelect(null)}>Close</button>}>
          <DataTable rows={blocks.drill} columns={drillColumns} rowKey={r => r.campaign_id} defaultSort={{ key: 'cost', direction: 'desc' }}
            storageKey="categories-campaigns" compareLabel={compareLabel || undefined} />
        </Card>
      )}
      {blocks.search.table.length > 0 && (
        <GroupCard title="Search" rows={blocks.search.table} columns={plainColumns} rowKey={r => r.name} footer={blocks.search.footer}
          storageKey="categories-search" compareLabel={compareLabel} trend={trend(blocks.search.rows, byCategory)} />
      )}
      {blocks.shopping.table.length > 0 && (
        <GroupCard title="Shopping" rows={blocks.shopping.table} columns={plainColumns} rowKey={r => r.name} footer={blocks.shopping.footer}
          storageKey="categories-shopping" compareLabel={compareLabel} trend={trend(blocks.shopping.rows, byCategory)} />
      )}
      {/* Moved from Buckets: the campaign view of the ProductHero buckets, per category. */}
      {blocks.shopping.buckets.columns.length > 0 && (
        <Card title="Shopping by bucket" subtitle="ROAS with cost below it, by category and bucket campaign (the bucket in brackets in the campaign name). No colour: the account ROAS goal applies blended, including Brand.">
          <BucketMatrix matrix={blocks.shopping.buckets} />
        </Card>
      )}
    </>
  );
}
