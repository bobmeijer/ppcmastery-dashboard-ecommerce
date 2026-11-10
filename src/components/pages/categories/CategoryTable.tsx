'use client';

import { displayNetwork } from '@/lib/filters';
import { Card } from '@/components/Card';
import { DataTable, Column } from '@/components/DataTable';
import type { Derived } from '@/lib/metrics';
import type { CampaignRow, CategoryRow, SubtypeRow } from '@/lib/categoriesShaping';
import { metricColumns, MetricColumnOptions } from './columns';

interface TableProps {
  rows: CategoryRow[];
  total: Derived;
  previousTotal: Derived | null;
  isProduct: boolean;
  selected: string | null;
  onSelect: (name: string | null) => void;
  options: MetricColumnOptions;
  notes: string[];
}

export function CategoryTable({ rows, total, previousTotal, isProduct, selected, onSelect, options, notes }: TableProps) {
  const nameLabel = isProduct ? 'Product type' : 'Category';
  const columns: Column<CategoryRow>[] = [
    {
      key: 'name', label: nameLabel, sortValue: r => r.name, csv: r => r.name,
      render: r => (
        <button type="button" className="text-left font-medium hover:underline max-sm:-my-2.5 max-sm:py-2.5" aria-pressed={selected === r.name}
          style={{ color: selected === r.name ? 'var(--accent)' : 'inherit' }} onClick={() => onSelect(selected === r.name ? null : r.name)}>
          {r.name}
          <span className="num ml-1.5 text-xs font-normal text-subtle max-sm:hidden">{r.items} {isProduct ? (r.items === 1 ? 'subtype' : 'subtypes') : (r.items === 1 ? 'campaign' : 'campaigns')}</span>
        </button>
      ),
    },
    ...metricColumns<CategoryRow>(options),
  ];
  const footer: CategoryRow = { name: 'Total', ...total, share: 1, previous: previousTotal, target_roas: null, items: 0 };
  return (
    <Card title={isProduct ? 'By product type' : 'By category'}
      subtitle={isProduct ? 'Product type level 1 from the Shopping product data. Click a row for the subtypes.' : 'Derived from the campaign names. Click a row for the campaigns.'}>
      {notes.map(note => <p key={note} className="mb-3 text-sm" style={{ color: 'var(--warn)' }}>{note}</p>)}
      <DataTable rows={rows} columns={columns} rowKey={r => r.name} defaultSort={{ key: 'cost', direction: 'desc' }}
        csvName={isProduct ? 'by-product-type' : 'by-category'} footer={footer} />
    </Card>
  );
}

interface CampaignDrillProps { category: string; rows: CampaignRow[]; options: MetricColumnOptions; onClose: () => void }

const statusLabel = (status: string) => (status === 'ENABLED' ? 'Active' : status === 'PAUSED' ? 'Paused' : status === 'REMOVED' ? 'Removed' : status);

export function CampaignDrillDown({ category, rows, options, onClose }: CampaignDrillProps) {
  const columns: Column<CampaignRow>[] = [
    { key: 'name', label: 'Campaign', render: r => <span className="font-medium">{r.name}</span>, sortValue: r => r.name, csv: r => r.name },
    { key: 'network', label: 'Network', mobileHidden: true, render: r => displayNetwork(r), sortValue: r => displayNetwork(r), csv: r => displayNetwork(r) },
    { key: 'bucket', label: 'Bucket', mobileHidden: true, render: r => r.bucket || <span className="text-subtle">-</span>, sortValue: r => r.bucket, csv: r => r.bucket },
    { key: 'status', label: 'Status', mobileHidden: true, sortValue: r => r.status, csv: r => statusLabel(r.status),
      render: r => <span style={{ color: r.status === 'ENABLED' ? 'var(--good)' : 'var(--gray-500)' }}>{statusLabel(r.status)}</span> },
    ...metricColumns<CampaignRow>(options),
  ];
  return (
    <DrillCard title={`Campaigns in ${category}`} subtitle="Share = share of cost within this category." onClose={onClose}>
      <DataTable rows={rows} columns={columns} rowKey={r => r.campaign_id} defaultSort={{ key: 'cost', direction: 'desc' }} csvName={`campaigns-${slug(category)}`} />
    </DrillCard>
  );
}

interface SubtypeDrillProps { category: string; rows: SubtypeRow[]; options: MetricColumnOptions; onClose: () => void }

export function SubtypeDrillDown({ category, rows, options, onClose }: SubtypeDrillProps) {
  const columns: Column<SubtypeRow>[] = [
    { key: 'name', label: 'Subtype', render: r => <span className="font-medium">{r.name}</span>, sortValue: r => r.name, csv: r => r.name },
    ...metricColumns<SubtypeRow>({ ...options, showTargetRoas: false }),
  ];
  return (
    <DrillCard title={`Subtypes within ${category}`} subtitle="Product type level 2. Share = share of cost within this product type." onClose={onClose}>
      <DataTable rows={rows} columns={columns} rowKey={r => r.name} defaultSort={{ key: 'cost', direction: 'desc' }} csvName={`subtypes-${slug(category)}`} maxRows={15} />
    </DrillCard>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function DrillCard({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Card title={title} subtitle={subtitle} actions={<button type="button" className="btn-chip" onClick={onClose}>Close</button>}>
      {children}
    </Card>
  );
}
