'use client';

// Category (rows) x campaign bucket (columns). Cell = ROAS with the cost
// underneath. No colour against the account target: the 400% floor is blended
// over all campaigns including Brand, so it is no fair bar per bucket
//. Built on DataTable so the columns sort (by ROAS) and the
// matrix exports as CSV.
import { DataTable, Column } from '@/components/DataTable';
import { Derived, formatMetric } from '@/lib/metrics';
import { BucketGroup, BucketMatrix as Matrix, MatrixRow } from '@/lib/bucketsShaping';

function Cell({ cell }: { cell: Derived | undefined }) {
  if (!cell) return <span className="text-subtle">-</span>;
  return (
    <div className="leading-tight">
      <div className="num font-medium">{formatMetric('roas', cell.roas)}</div>
      <div className="num text-xs text-muted">{formatMetric('cost', cell.cost)}</div>
    </div>
  );
}

export function BucketMatrix({ matrix }: { matrix: Matrix }) {
  const bucketColumn = (group: BucketGroup): Column<MatrixRow> => ({
    key: group, label: group, numeric: true,
    render: r => <Cell cell={r.cells[group]} />,
    sortValue: r => r.cells[group]?.roas ?? null,
    csv: r => (r.cells[group] ? `${r.cells[group]!.roas?.toFixed(2) ?? ''} | ${r.cells[group]!.cost.toFixed(2)}` : ''),
  });
  const columns: Column<MatrixRow>[] = [
    { key: 'category', label: 'Category', render: r => r.category, sortValue: r => r.category, csv: r => r.category },
    ...matrix.columns.map(bucketColumn),
    {
      key: 'total', label: 'Total', numeric: true,
      render: r => <Cell cell={r.total} />,
      sortValue: r => r.total.roas, csv: r => `${r.total.roas?.toFixed(2) ?? ''} | ${r.total.cost.toFixed(2)}`,
    },
  ];
  const footer: MatrixRow = { category: 'Total', cells: matrix.columnTotals, total: matrix.total };
  return <DataTable rows={matrix.rows} columns={columns} rowKey={r => r.category} csvName="buckets-by-category" footer={footer} />;
}
