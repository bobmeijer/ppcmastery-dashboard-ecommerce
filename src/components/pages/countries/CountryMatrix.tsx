'use client';

// Countries: rows = category or network, columns = NL / BE / Other / Total, cell = cost with ROAS underneath.
// No colour against the account ROAS target: the target is blended over all
// campaigns including Brand, so it is no fair bar per row.
// In comparison mode each cell shows the previous cost and the delta.
import { DataTable, Column } from '@/components/DataTable';
import { Derived, formatMetric, formatMetricDelta, metricDefinition } from '@/lib/metrics';
import { COUNTRY_KEYS, CountryKey, MatrixRow } from '@/lib/geoShaping';

function Cell({ d }: { d: Derived | null }) {
  if (!d) return <span className="text-subtle">-</span>;
  return (
    <div className="leading-tight">
      <div>{formatMetric('cost', d.cost)}</div>
      {/* Phones drop the "ROAS" word (the card subtitle names it) so NL, BE and Total fit
          without sideways scrolling. */}
      <div className="text-xs text-muted"><span className="max-sm:hidden">ROAS </span>{formatMetric('roas', d.roas)}</div>
    </div>
  );
}

const csvCell = (d: Derived | null) => (d ? `${d.cost.toFixed(2)} (ROAS ${d.roas === null ? '-' : d.roas.toFixed(2)})` : '');

const costCompare = (previous: (r: MatrixRow) => number | null): Column<MatrixRow>['compare'] => ({
  previous,
  format: v => formatMetric('cost', v),
  deltaFormat: v => formatMetricDelta('cost', v),
  higherIsBetter: metricDefinition('cost')?.higherIsBetter ?? null,
});

export function CountryMatrix({ rows, footer, nameLabel, storageKey, compareLabel, showOther, maxRows, sortByCost = true }: {
  rows: MatrixRow[]; footer: MatrixRow; nameLabel: string; storageKey: string; compareLabel: string; showOther: boolean; maxRows?: number;
  sortByCost?: boolean;   // false keeps the row order from the shaping (networks in NETWORK_ORDER)
}) {
  const countries: CountryKey[] = COUNTRY_KEYS.filter(c => c !== 'Other' || showOther);
  const compare = !!compareLabel;
  const columns: Column<MatrixRow>[] = [
    { key: 'name', label: nameLabel,
      // Phones: long names wrap instead of truncating, so the numbers fit beside them.
      render: r => <span className="max-sm:whitespace-normal">{r.name}</span>, sortValue: r => r.name, csv: r => r.name },
    ...countries.map((code): Column<MatrixRow> => ({
      key: code, label: code, numeric: true,
      // Phones keep NL, BE and Total; Other is the smallest slice.
      mobileHidden: code === 'Other',
      render: r => <Cell d={r[code]} />,
      sortValue: r => r[code]?.cost ?? null,
      csv: r => csvCell(r[code]),
      ...(compare ? { compare: costCompare(r => (r.previous ? r.previous[code]?.cost ?? 0 : null)) } : {}),
    })),
    {
      key: 'total', label: 'Total', numeric: true, render: r => <Cell d={r.total} />, sortValue: r => r.total.cost, csv: r => csvCell(r.total),
      ...(compare ? { compare: costCompare(r => (r.previous ? r.previous.total.cost : null)) } : {}),
    },
  ];
  return (
    <DataTable rows={rows} columns={columns} rowKey={r => r.name} defaultSort={sortByCost ? { key: 'total', direction: 'desc' } : undefined}
      storageKey={storageKey} compareLabel={compareLabel || undefined} footer={footer} maxRows={maxRows} />
  );
}
