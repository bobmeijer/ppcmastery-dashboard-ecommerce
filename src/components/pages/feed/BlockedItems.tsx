'use client';

import { BRAND } from '@/lib/config';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import { Column, DataTable } from '@/components/DataTable';
import { fmtNumber } from '@/lib/metrics';
import { describeIssue, FeedItem, FeedSnapshot, filterItems, issueIndex, itemKey, itemSeverity } from '@/lib/feedShaping';
import { availabilityLabel, merchantStatusLabel, SeverityChip } from './shared';
import { safeHref } from '@/lib/safeUrl';

// "Done" lives in localStorage per label.
const storageKey = (label: string) => `feed-done:${label}`;

function readDone(label: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(label));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

function writeDone(label: string, done: Set<string>) {
  try { window.localStorage.setItem(storageKey(label), JSON.stringify([...done])); } catch { /* private window or blocked storage */ }
}

interface Props { snapshot: FeedSnapshot; issue: string | null; onIssueChange: (code: string | null) => void }

export function BlockedItems({ snapshot, issue, onIssueChange }: Props) {
  const [query, setQuery] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  useEffect(() => { setDone(readDone(snapshot.label)); }, [snapshot.label]);

  const index = useMemo(() => issueIndex(snapshot.issues), [snapshot.issues]);
  const filtered = useMemo(() => {
    const rows = filterItems(snapshot.items, { issue, query }, index);
    return hideDone ? rows.filter(r => !done.has(itemKey(r))) : rows;
  }, [snapshot.items, issue, query, index, hideDone, done]);

  const toggle = (id: string) => {
    setDone(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeDone(snapshot.label, next);
      return next;
    });
  };

  const issueOptions = snapshot.issues.filter(i => i.blocked > 0).sort((a, b) => b.blocked - a.blocked);
  const doneCount = snapshot.items.filter(i => done.has(itemKey(i))).length;

  const columns: Column<FeedItem>[] = [
    {
      key: 'done', label: 'Done',
      render: r => <input type="checkbox" className="h-4 w-4 !p-0 max-sm:h-5 max-sm:w-5" checked={done.has(itemKey(r))} onChange={() => toggle(itemKey(r))} aria-label={`Mark ${r.title} done`} />,
      sortValue: r => (done.has(itemKey(r)) ? 1 : 0), csv: r => (done.has(itemKey(r)) ? 'yes' : 'no'),
    },
    // Phones keep Done, product and issues; the title already links to the page.
    { key: 'offerId', label: 'Item ID', mobileHidden: true, render: r => <span className="font-mono text-xs">{r.offerId}{r.feedLabel && <span className="ml-1 text-muted">{r.feedLabel}</span>}</span>, sortValue: r => itemKey(r), csv: r => itemKey(r) },
    {
      key: 'title', label: 'Product',
      render: r => (
        <div className={done.has(itemKey(r)) ? 'text-muted line-through' : ''}>
          {/* Phones: long feed titles stop at three lines; the full title stays in the tooltip and the CSV. */}
          {safeHref(r.link) ? <a href={safeHref(r.link)!} title={r.title} target="_blank" rel="noreferrer" className="underline decoration-[var(--gray-300)] underline-offset-2 hover:decoration-[var(--ink)] max-sm:line-clamp-3">{r.title}</a> : <span className="max-sm:line-clamp-3">{r.title}</span>}
          {!r.link && <div className="text-[11px] text-muted">no link in the feed</div>}
        </div>
      ),
      sortValue: r => r.title, csv: r => r.title,
    },
    {
      key: 'issues', label: 'Issues',
      render: r => (
        <div className="flex flex-wrap gap-1">
          {r.issueCodes.map(code => (
            <button key={code} type="button" onClick={() => onIssueChange(code)} title={`${index.get(code)?.action ?? code}. Click to filter on this issue.`}
              className="rounded-[4px] border px-1.5 py-0.5 text-[11px] leading-tight hover:border-[var(--gray-400)]"
              style={{ borderColor: 'var(--line)', color: index.get(code)?.severity === 'blocking' ? 'var(--bad)' : 'var(--ink-soft)' }}>
              {describeIssue(code, index)}
            </button>
          ))}
        </div>
      ),
      sortValue: r => (itemSeverity(r, index) === 'blocking' ? 0 : 1), csv: r => r.issueCodes.map(code => describeIssue(code, index)).join(' | '),
    },
    { key: 'severity', label: 'Severity', mobileHidden: true, render: r => <SeverityChip severity={itemSeverity(r, index)} />, sortValue: r => (itemSeverity(r, index) === 'blocking' ? 0 : 1), csv: r => itemSeverity(r, index) },
    { key: 'availability', label: 'Availability', mobileHidden: true, render: r => availabilityLabel(r.availability), sortValue: r => availabilityLabel(r.availability), csv: r => availabilityLabel(r.availability) },
    { key: 'merchant', label: 'Merchant Center', mobileHidden: true, render: r => merchantStatusLabel(r.merchantStatus), sortValue: r => merchantStatusLabel(r.merchantStatus), csv: r => merchantStatusLabel(r.merchantStatus) },
    { key: 'link', label: 'Page', mobileHidden: true, render: r => (safeHref(r.link) ? <a href={safeHref(r.link)!} target="_blank" rel="noreferrer" className="text-xs underline">Open</a> : <span className="text-xs text-muted">-</span>), csv: r => r.link ?? '' },
  ];

  const capped = snapshot.itemsTotal > snapshot.items.length;

  return (
    <Card title="Blocked items"
      subtitle={`Worklist for ${BRAND.client}: ${fmtNumber(snapshot.itemsTotal)} items not showing in Shopping right now${capped ? ` (first ${fmtNumber(snapshot.items.length)} shown)` : ''}. Tick off what is fixed; the next sync confirms it.`}
      actions={(
        <div className="flex flex-wrap items-center gap-2 text-sm max-sm:w-full">
          <select className="max-w-full max-sm:w-full" value={issue ?? ''} onChange={e => onIssueChange(e.target.value || null)} aria-label="Filter by issue">
            <option value="">All issues</option>
            {issueOptions.map(i => <option key={i.code} value={i.code}>{i.description} ({i.blocked})</option>)}
          </select>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title or item ID" aria-label="Search" className="w-56 max-sm:w-full" />
          <label className="flex items-center gap-1.5 text-xs text-muted max-sm:min-h-10">
            <input type="checkbox" className="h-3.5 w-3.5 !p-0" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> Hide completed
          </label>
        </div>
      )}>
      <div className="mb-3 text-xs text-muted">
        {fmtNumber(filtered.length)} of {fmtNumber(snapshot.items.length)} items{issue ? `, filtered on "${describeIssue(issue, index)}"` : ''}{doneCount > 0 ? `, ${fmtNumber(doneCount)} done` : ''}
        {issue && <button type="button" className="ml-2 underline" onClick={() => onIssueChange(null)}>clear filter</button>}
      </div>
      {snapshot.items.length === 0 ? <p className="text-sm text-muted">No blocked items: everything in the feed is eligible for Shopping.</p>
        : filtered.length === 0 ? <p className="text-sm text-muted">No items match this filter.</p>
        : <DataTable rows={filtered} columns={columns} rowKey={itemKey} maxRows={25} csvName={`feed-worklist-${snapshot.label}-${snapshot.snapshotDate}`} />}
    </Card>
  );
}
