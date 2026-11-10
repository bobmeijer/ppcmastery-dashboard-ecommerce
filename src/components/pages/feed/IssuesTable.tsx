'use client';

import { Card } from '@/components/Card';
import { Column, DataTable } from '@/components/DataTable';
import { fmtNumber, fmtPercent } from '@/lib/metrics';
import { FeedSnapshot, IssueRow, issueRows } from '@/lib/feedShaping';
import { SeverityChip } from './shared';

export function IssuesTable({ snapshot, onSelectIssue }: { snapshot: FeedSnapshot; onSelectIssue: (code: string) => void }) {
  const rows = issueRows(snapshot);
  const columns: Column<IssueRow>[] = [
    {
      key: 'description', label: 'Issue',
      render: r => (
        // Phones: the description wraps inside the capped first column, the code truncates.
        <div className="max-sm:whitespace-normal">
          <div>{r.description}</div>
          <div className="font-mono text-[11px] text-muted max-sm:truncate" title={r.code}>{r.code}</div>
        </div>
      ),
      sortValue: r => r.description, csv: r => `${r.description} (${r.code})`,
    },
    // Phones keep issue, items and blocked: a count above 0 under Blocked already says it blocks.
    { key: 'severity', label: 'Severity', mobileHidden: true, render: r => <SeverityChip severity={r.severity} />, sortValue: r => (r.severity === 'blocking' ? 0 : 1), csv: r => (r.severity === 'blocking' ? 'blocking' : 'warning') },
    { key: 'products', label: 'Items', numeric: true, render: r => fmtNumber(r.products), sortValue: r => r.products, csv: r => r.products },
    { key: 'share', label: 'Share', numeric: true, mobileHidden: true, render: r => fmtPercent(r.share, 1), sortValue: r => r.share, csv: r => (r.share === null ? '' : (r.share * 100).toFixed(2)) },
    {
      key: 'blocked', label: 'Blocked', numeric: true,
      render: r => (r.blocked > 0 ? <button type="button" className="underline max-sm:-my-2 max-sm:min-h-10 max-sm:pl-3" onClick={() => onSelectIssue(r.code)} title="Show these items in the worklist">{fmtNumber(r.blocked)}</button> : fmtNumber(0)),
      sortValue: r => r.blocked, csv: r => r.blocked,
    },
    { key: 'action', label: 'What to do', mobileHidden: true, render: r => <span className="block max-w-[360px] whitespace-normal text-xs text-muted">{r.action}</span>, csv: r => r.action },
  ];
  return (
    <Card title="Issues" subtitle="By issue code: how many items it affects and whether it blocks serving. Click a number to see those items in the worklist.">
      {rows.length === 0 ? <p className="text-sm text-muted">No issues in this snapshot.</p> : (
        <DataTable rows={rows} columns={columns} rowKey={r => r.code} csvName={`feed-issues-${snapshot.label}-${snapshot.snapshotDate}`} />
      )}
    </Card>
  );
}
