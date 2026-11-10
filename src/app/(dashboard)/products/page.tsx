'use client';

// Products: organised around the ProductHero buckets.
// One product list with bucket chips (current label) and the rollup per
// product type; the bucket tiles moved to the Buckets page. The
// product type filter sits in the top bar and applies to all of it.
// Aggregation happens server-side (src/lib/reports-products.ts).
import { LOCALE } from '@/lib/config';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useHrefWith } from '@/components/pageLinks';
import { Card, Notice } from '@/components/Card';
import { ProductsSkeleton } from '@/components/PageSkeletons';
import { DataTable } from '@/components/DataTable';
import { InfoTip } from '@/components/Badges';
import { useScope } from '@/components/ScopeContext';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useSetFilterOptions } from '@/components/FilterOptionsContext';
import { useProductsReport, ProductsReport } from '@/hooks/useProducts';
import { fmtNumber } from '@/lib/metrics';
import { applyChip, labelName, ProductChip, searchProducts } from '@/lib/productsShaping';
import { productColumns, typeColumns } from '@/components/pages/products/ProductColumns';
import { ProductPanel } from '@/components/pages/products/ProductPanel';

const monthLabel = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });

const LABEL_INFO = 'The label is the one the product has in the feed now (custom_label_2, set by ProductHero), with the figures for the selected period. If a product changed label within the period, the split is shown under the label. The Buckets page counts per day with the label at that time, like Google Ads.';

const sameChip = (a: ProductChip, b: ProductChip) => JSON.stringify(a) === JSON.stringify(b);

function SourceNote({ data }: { data: ProductsReport }) {
  if (data.source !== 'monthly') return null;
  return (
    <Notice tone="warn">
      This period starts before the oldest day in the daily product table. The figures therefore come from the monthly table and cover whole calendar months:
      {' '}{monthLabel(data.range.start)} to {monthLabel(data.range.end)}.
    </Notice>
  );
}

function ProductList({ data, scope, chip, onChip }: { data: ProductsReport; scope: string; chip: ProductChip; onChip: (c: ProductChip) => void }) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => searchProducts(applyChip(data.products, chip), query), [data.products, chip, query]);
  const columns = useMemo(() => productColumns(data.labelled), [data.labelled]);
  const { range, lagDays } = useScope();
  const hrefWith = useHrefWith();
  // Panel: the open product and its place in the current list (chip + search).
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = openId ? rows.findIndex(r => r.id === openId) : -1;
  const open = openIndex >= 0 ? rows[openIndex] : null;
  const chips: { chip: ProductChip; name: string; count: number }[] = [
    { chip: { kind: 'all' }, name: 'All', count: data.products.length },
    // "No label" stays hidden; those products remain under All.
    ...(data.labelled ? data.buckets.filter(b => b.label !== '').map(b => ({ chip: { kind: 'label', label: b.label } as ProductChip, name: labelName(b.label), count: b.products })) : []),
  ];
  return (
    // title and bucket chips left; search and the column icon right, one line.
    <Card
      heading={(
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1.5">
            <h2 className="text-base font-semibold tracking-tight">Products</h2>
            <InfoTip label="Label" text={LABEL_INFO} />
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c, i) => (
              <button key={i} type="button" className="btn-chip" data-active={sameChip(chip, c.chip)} onClick={() => onChip(c.chip)}>
                {c.name} <span className="num ml-1 text-[11px] opacity-70">{fmtNumber(c.count)}</span>
              </button>
            ))}
          </div>
          {data.labelled && <Link href={hrefWith('/buckets', { bucket: null })} className="text-sm underline decoration-[var(--gray-300)] underline-offset-2 hover:decoration-[var(--ink)]">History and switches on Buckets</Link>}
        </div>
      )}
      actions={<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title, ID or brand" aria-label="Search products" className="w-56 text-sm" />}>
      {rows.length === 0
        ? <p className="text-sm text-muted">No products match this filter.</p>
        : <DataTable rows={rows} columns={columns} rowKey={r => r.id} defaultSort={{ key: 'conversions_value', direction: 'desc' }} csvName={`products-${scope}`} storageKey="products-list" maxRows={25}
            onRowClick={r => setOpenId(r.id)} selectedKey={openId} />}
      {open && (
        <ProductPanel product={open} scope={scope} period={range} lagDays={lagDays} position={{ index: openIndex, total: rows.length }}
          onPrev={openIndex > 0 ? () => setOpenId(rows[openIndex - 1].id) : null}
          onNext={openIndex < rows.length - 1 ? () => setOpenId(rows[openIndex + 1].id) : null}
          onClose={() => setOpenId(null)} />
      )}
    </Card>
  );
}

function ByType({ data, scope }: { data: ProductsReport; scope: string }) {
  const columns = useMemo(() => typeColumns(data.by_type_level), [data.by_type_level]);
  const footer = { name: 'Total', products: data.products.length, ...data.totals, cost_share: 1, revenue_share: 1 };
  const subtitle = data.by_type_level === 1 ? 'First level of the product type from the feed' : 'Second level within the selected product type';
  return (
    <Card title="By product type" subtitle={subtitle}>
      <DataTable rows={data.by_type} columns={columns} rowKey={r => r.name} defaultSort={{ key: 'conversions_value', direction: 'desc' }} csvName={`products-by-type-${scope}`} maxRows={15} footer={footer} />
    </Card>
  );
}

export default function ProductsPage() {
  const { scope } = useScope();
  const { data, error, loading } = useProductsReport();
  // ?bucket=H (from the Buckets page) preselects that bucket.
  const params = useSearchParams();
  const [chip, setChip] = useState<ProductChip>(() => {
    const bucket = params.get('bucket');
    return bucket && ['H', 'S', 'V', 'Z'].includes(bucket) ? { kind: 'label', label: bucket } : { kind: 'all' };
  });
  const freshest = useMemo(() => (data ? Object.values(data.freshness).filter(Boolean).sort().pop() || null : null), [data]);
  useSetFreshness(freshest);
  const filterOptions = useMemo(() => (data ? { campaigns: [], networks: [], productTypes: data.type_options } : null), [data]);
  useSetFilterOptions(filterOptions, loading && !data ? 'types' : null);
  const empty = !!data && data.products.length === 0;

  return (
    <div className="space-y-[var(--page-gap)]">
      {error && <Notice tone="bad">Report could not be loaded: {error}</Notice>}
      {loading && !data && <ProductsSkeleton />}
      {data && (
        <>
          <SourceNote data={data} />
          {empty && <Notice tone="warn">No products for this period and filter.</Notice>}
          {!empty && (
            <>
              <ProductList data={data} scope={scope} chip={chip} onChip={setChip} />
              <ByType data={data} scope={scope} />
            </>
          )}
        </>
      )}
    </div>
  );
}
