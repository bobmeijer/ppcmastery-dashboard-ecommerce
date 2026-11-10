'use client';

// Column sets for the Products tables. The product cell (thumbnail, linked
// title, id) and the bucket chip are shared with the Buckets page.
import type { Column } from '@/components/DataTable';
import { fmtNumber, fmtPercent, formatMetric } from '@/lib/metrics';
import { labelName, LabelShare, ProductDerived, ProductListRow, ProductTypeRow } from '@/lib/productsShaping';
import { typeName } from '@/lib/productTypes';
import { safeHref } from '@/lib/safeUrl';

// Thumbnail from the feed sync; a blank tile keeps the column aligned when there is none.
export const ProductThumb = ({ src, size = 40, className = '' }: { src?: string | null; size?: number; className?: string }) => (
  <span className={`product-thumb ${className}`} style={{ width: size, height: size }}>
    {/* External shop images: plain img on purpose, next/image would proxy them through Vercel. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {src && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />}
  </span>
);

type Identity = { id: string; title: string; link?: string | null; image?: string | null; ads_status?: string | null };

// Title links to the product page in the shop, like the Feed status work list.
// Phones: smaller thumbnail and the title on up to two
// lines inside the capped first column, instead of six characters and an ellipsis.
export const TitleCell = ({ row }: { row: Identity }) => (
  <div className="flex min-w-[16rem] max-w-[30rem] items-center gap-3 max-sm:min-w-0 max-sm:gap-2">
    <ProductThumb src={row.image} className="max-sm:!h-8 max-sm:!w-8" />
    <div className="min-w-0">
      {row.link
        ? <a href={safeHref(row.link) ?? undefined} target="_blank" rel="noreferrer" className="block truncate font-medium underline decoration-[var(--gray-300)] underline-offset-2 hover:decoration-[var(--ink)] max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:leading-snug" title={row.title}>{row.title}</a>
        : <div className="truncate font-medium max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:leading-snug" title={row.title}>{row.title}</div>}
      <div className="num truncate text-xs text-subtle" title={row.id}>
        {row.id}
        {row.ads_status === 'NOT_ELIGIBLE' && <span className="ml-2" style={{ color: 'var(--bad)' }}>not eligible for Shopping</span>}
      </div>
    </div>
  </div>
);

// Phones keep Cost, Revenue (the default sort) and ROAS.
const MOBILE_KEPT: (keyof ProductDerived)[] = ['cost', 'conversions_value', 'roas'];

// H / S / V / Z chip in the bucket colours (globals.css .bucket-chip).
// phoneShort: just the letter on phones, for tight grids like the transition matrix.
export const BucketChip = ({ label, phoneShort = false }: { label: string; phoneShort?: boolean }) => (
  <span className="bucket-chip" data-label={label || 'none'} title={phoneShort ? labelName(label) : undefined}>
    {phoneShort ? <><span className="max-sm:hidden">{labelName(label)}</span><span className="sm:hidden">{label || '-'}</span></> : labelName(label)}
  </span>
);

// Cost share per label inside the period, for products that switched bucket.
const SplitLine = ({ split }: { split: LabelShare[] }) => {
  const total = split.reduce((a, s) => a + s.cost, 0);
  if (split.length < 2 || total <= 0) return null;
  const detail = split.map(s => `${labelName(s.label)}: ${formatMetric('cost', s.cost)} cost, ${formatMetric('conversions_value', s.conversions_value)} revenue`).join('\n');
  return (
    <div className="mt-0.5 whitespace-nowrap text-[11px] text-muted" title={`Label at the time, in this period:\n${detail}`}>
      {split.map(s => `${s.label || '-'} ${fmtPercent(s.cost / total, 0)}`).join(' / ')}
    </div>
  );
};

export const metricColumns = <T extends ProductDerived>(keys: (keyof ProductDerived)[]): Column<T>[] => {
  const all: Record<keyof ProductDerived, Column<T>> = {
    cost: { key: 'cost', label: 'Cost', numeric: true, render: r => formatMetric('cost', r.cost), sortValue: r => r.cost, csv: r => r.cost.toFixed(2) },
    conversions_value: { key: 'conversions_value', label: 'Revenue', numeric: true, render: r => formatMetric('conversions_value', r.conversions_value), sortValue: r => r.conversions_value, csv: r => r.conversions_value.toFixed(2) },
    roas: { key: 'roas', label: 'ROAS', numeric: true, render: r => formatMetric('roas', r.roas), sortValue: r => r.roas, csv: r => r.roas?.toFixed(2) ?? '' },
    conversions: { key: 'conversions', label: 'Purchases', numeric: true, render: r => fmtNumber(r.conversions, 1), sortValue: r => r.conversions, csv: r => r.conversions.toFixed(1) },
    cpa: { key: 'cpa', label: 'CPA', numeric: true, render: r => formatMetric('cpa', r.cpa), sortValue: r => r.cpa, csv: r => r.cpa?.toFixed(2) ?? '' },
    clicks: { key: 'clicks', label: 'Clicks', numeric: true, render: r => fmtNumber(r.clicks), sortValue: r => r.clicks, csv: r => r.clicks },
    impressions: { key: 'impressions', label: 'Impressions', numeric: true, render: r => fmtNumber(r.impressions), sortValue: r => r.impressions, csv: r => r.impressions },
    ctr: { key: 'ctr', label: 'CTR', numeric: true, render: r => fmtPercent(r.ctr, 2), sortValue: r => r.ctr, csv: r => r.ctr?.toFixed(4) ?? '' },
    cvr: { key: 'cvr', label: 'CVR', numeric: true, render: r => fmtPercent(r.cvr, 2), sortValue: r => r.cvr, csv: r => r.cvr?.toFixed(4) ?? '' },
  };
  return keys.map(k => ({ ...all[k], mobileHidden: !MOBILE_KEPT.includes(k) }));
};

const LABEL_SORT = ['H', 'S', 'V', 'Z'];

export const productColumns = (labelled: boolean): Column<ProductListRow>[] => [
  { key: 'title', label: 'Product', render: r => <TitleCell row={r} />, sortValue: r => r.title, csv: r => r.title },
  ...(labelled ? [{
    key: 'label', label: 'Label', mobileHidden: true,
    render: (r: ProductListRow) => <div><BucketChip label={r.label} /><SplitLine split={r.label_split} /></div>,
    sortValue: (r: ProductListRow) => (LABEL_SORT.indexOf(r.label) + 5) % 9, csv: (r: ProductListRow) => labelName(r.label),
  }] : []),
  {
    key: 'type', label: 'Product type', mobileHidden: true,
    render: r => <span className="block max-w-[14rem] truncate text-muted" title={r.product_type}>{typeName(r.type_l2 || r.type_l1)}</span>,
    sortValue: r => `${r.type_l1}|${r.type_l2}`, csv: r => r.product_type,
  },
  ...metricColumns<ProductListRow>(['cost', 'conversions_value', 'roas', 'conversions', 'cpa', 'clicks', 'impressions', 'ctr', 'cvr']),
  { key: 'revenue_share', label: 'Revenue share', numeric: true, mobileHidden: true, render: r => fmtPercent(r.revenue_share), sortValue: r => r.revenue_share, csv: r => r.revenue_share?.toFixed(4) ?? '' },
];

export const typeColumns = (level: 1 | 2): Column<ProductTypeRow>[] => [
  { key: 'name', label: level === 1 ? 'Product type' : 'Product type level 2', render: r => typeName(r.name), sortValue: r => r.name, csv: r => r.name },
  { key: 'products', label: 'Products', numeric: true, mobileHidden: true, render: r => fmtNumber(r.products), sortValue: r => r.products, csv: r => r.products },
  ...metricColumns<ProductTypeRow>(['cost']),
  { key: 'cost_share', label: 'Cost share', numeric: true, mobileHidden: true, render: r => fmtPercent(r.cost_share), sortValue: r => r.cost_share, csv: r => r.cost_share?.toFixed(4) ?? '' },
  ...metricColumns<ProductTypeRow>(['conversions_value']),
  { key: 'revenue_share', label: 'Revenue share', numeric: true, mobileHidden: true, render: r => fmtPercent(r.revenue_share), sortValue: r => r.revenue_share, csv: r => r.revenue_share?.toFixed(4) ?? '' },
  ...metricColumns<ProductTypeRow>(['roas', 'conversions', 'clicks', 'ctr', 'cvr']),
];
