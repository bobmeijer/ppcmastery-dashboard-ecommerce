'use client';

// Device x dimension table: one column per active device, each cell shows
// cost (bold) with ROAS and CVR underneath. Sorting by a device column sorts on its cost.
// No colour against the account ROAS target: the target is blended over all
// campaigns including Brand, so it is no fair bar per row.
// In comparison mode each cell shows the previous cost and the delta.
import { DataTable, Column } from '@/components/DataTable';
import { fmtPercent, formatMetric, formatMetricDelta, metricDefinition } from '@/lib/metrics';
import type { DeviceDefinition, MatrixCell, MatrixRow } from '@/lib/devicesShaping';
import { useIsPhone } from '@/hooks/useIsMobile';

function Cell({ cell }: { cell: MatrixCell | undefined }) {
  if (!cell || (cell.cost <= 0 && cell.clicks <= 0)) return <span className="text-subtle">-</span>;
  return (
    <div className="num leading-tight">
      <div className="font-medium">{formatMetric('cost', cell.cost)}</div>
      <div className="mt-0.5 whitespace-nowrap text-xs text-muted">
        {/* Phones show ROAS only, without the word (the card subtitle names it). */}
        <span className="max-sm:hidden">ROAS </span>{formatMetric('roas', cell.roas)}<span className="max-sm:hidden">{' / '}CVR {fmtPercent(cell.cvr)}</span>
      </div>
    </div>
  );
}

const csvCell = (cell: MatrixCell | undefined) => {
  if (!cell) return '';
  const roas = cell.roas === null ? '-' : cell.roas.toFixed(2);
  const cvr = cell.cvr === null ? '-' : `${(cell.cvr * 100).toFixed(2)}%`;
  return `${cell.cost.toFixed(2)} | ROAS ${roas} | CVR ${cvr}`;
};

const costCompare = (previous: (r: MatrixRow) => number | null): Column<MatrixRow>['compare'] => ({
  previous,
  format: v => formatMetric('cost', v),
  deltaFormat: v => formatMetricDelta('cost', v),
  higherIsBetter: metricDefinition('cost')?.higherIsBetter ?? null,
});

interface Props {
  rows: MatrixRow[];
  total: MatrixRow;
  devices: DeviceDefinition[];
  nameLabel: string;
  storageKey: string;
  compareLabel: string;   // '' = no comparison
  maxRows?: number;
  sortByCost?: boolean;   // false keeps the row order from the shaping (networks in NETWORK_ORDER)
}

export function DeviceMatrix({ rows, total, devices, nameLabel, storageKey, compareLabel, maxRows, sortByCost = true }: Props) {
  const compare = !!compareLabel;
  const phone = useIsPhone();
  const columns: Column<MatrixRow>[] = [
    { key: 'name', label: nameLabel,
      // Phones: long names wrap instead of truncating, so the numbers fit beside them.
      render: r => <span className="max-sm:whitespace-normal">{r.name}</span>, sortValue: r => r.name, csv: r => r.name },
    ...devices.map((d): Column<MatrixRow> => ({
      key: d.key, label: d.label, numeric: true,
      // Phones keep Mobile and Desktop, the two that carry the spend.
      mobileHidden: d.key === 'tablet' || d.key === 'other',
      render: r => <Cell cell={r.cells[d.key]} />,
      sortValue: r => r.cells[d.key]?.cost ?? null,
      csv: r => csvCell(r.cells[d.key]),
      ...(compare ? { compare: costCompare(r => (r.previous ? r.previous.cells[d.key]?.cost ?? 0 : null)) } : {}),
    })),
    {
      key: 'cost', label: phone ? 'Total' : 'Total cost', numeric: true, render: r => <span className="num">{formatMetric('cost', r.cost)}</span>, sortValue: r => r.cost, csv: r => r.cost.toFixed(2),
      ...(compare ? { compare: costCompare(r => (r.previous ? r.previous.cost : null)) } : {}),
    },
  ];
  return (
    <DataTable rows={rows} columns={columns} rowKey={r => r.name} defaultSort={sortByCost ? { key: 'cost', direction: 'desc' } : undefined}
      storageKey={storageKey} compareLabel={compareLabel || undefined} footer={total} maxRows={maxRows} />
  );
}
