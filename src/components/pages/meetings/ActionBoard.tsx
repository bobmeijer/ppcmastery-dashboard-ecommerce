'use client';

import { accountName } from '@/lib/config';
import { useMemo, useState } from 'react';
import { Card, Notice } from '@/components/Card';
import { Action, ActionStatus, BoardTab, ageInDays, filterActions, fmtDate, ownerInitials } from '@/lib/meetingsShaping';

const TABS: { value: BoardTab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
];

const STATUS_LABEL: Record<ActionStatus, string> = { open: 'open', done: 'done', dropped: 'dropped' };

export function Avatar({ owner }: { owner: string }) {
  const admin = /^admin$/i.test(owner);
  return (
    <span title={owner} className="num inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={admin ? { background: 'var(--ink)', color: 'var(--paper)' } : { background: 'var(--paper-alt)', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}>
      {ownerInitials(owner)}
    </span>
  );
}

export function LabelTag({ label }: { label: string | null }) {
  if (!label) return <span className="text-xs text-subtle">both</span>;
  return <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-[11px] text-ink-soft">{accountName(label)}</span>;
}

export function ActionBoard({ actions, scope, today, overrides, onStatus, source }: {
  actions: Action[];
  scope: string;
  today: string;
  overrides: Record<string, ActionStatus>;
  onStatus: (id: string, status: ActionStatus) => void;
  source: (sourceId: string) => { href: string; text: string } | null;
}) {
  const [tab, setTab] = useState<BoardTab>('open');
  const rows = useMemo(() => filterActions(actions, scope, tab, overrides), [actions, scope, tab, overrides]);
  const counts = useMemo(() => ({
    open: filterActions(actions, scope, 'open', overrides).length,
    done: filterActions(actions, scope, 'done', overrides).length,
    all: filterActions(actions, scope, 'all', overrides).length,
  }), [actions, scope, overrides]);

  return (
    <Card title="Actions" subtitle="Action items from meetings and email, carried over until they are done."
      actions={(
        <div className="flex items-center gap-1" role="tablist">
          {TABS.map(t => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className="btn-chip" data-active={tab === t.value} onClick={() => setTab(t.value)}>
              {/* ml-1: btn-chip is a flex box, which drops the space before the count. */}
              {t.label}<span className="num ml-1 opacity-70">{counts[t.value]}</span>
            </button>
          ))}
        </div>
      )}>
      {rows.length === 0 && <Notice tone="info">{tab === 'open' ? 'No open actions for this account.' : 'No actions in this list yet.'}</Notice>}
      {rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map(a => {
            const age = ageInDays(a.created, today);
            const overdue = a.status === 'open' && a.due !== null && a.due < today;
            const from = source(a.source_id);
            return (
              // Below lg a grid: avatar | text | age, buttons on their own row under the text. The
              // wrapping flex row squeezed the title to one word per line.
              <li key={a.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-3 lg:flex lg:flex-nowrap lg:items-center lg:py-2.5">
                <Avatar owner={a.owner} />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${a.status === 'open' ? 'text-ink' : 'text-muted line-through decoration-[var(--gray-300)]'}`}>{a.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span>{a.owner}</span>
                    <span aria-hidden>&middot;</span>
                    <LabelTag label={a.label} />
                    <span aria-hidden>&middot;</span>
                    {/* Touch: taller hit area, net zero layout. */}
                    {from ? <a href={from.href} className="underline-offset-2 hover:underline max-lg:-my-3 max-lg:py-3">{from.text}</a> : <span>{fmtDate(a.created)}</span>}
                    {a.due && (
                      <>
                        <span aria-hidden>&middot;</span>
                        <span style={overdue ? { color: 'var(--bad)' } : undefined}>deadline {fmtDate(a.due)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="num shrink-0 text-right text-xs max-lg:pt-0.5 lg:w-16" style={{ color: a.status === 'open' ? (age > 60 ? 'var(--warn)' : 'var(--gray-500)') : 'var(--gray-400)' }}>
                  {a.status === 'open' ? `${age} d` : STATUS_LABEL[a.status]}
                </div>
                <div className="col-span-2 col-start-2 flex shrink-0 items-center gap-1">
                  {a.status === 'open' ? (
                    <>
                      <button type="button" className="btn-chip" onClick={() => onStatus(a.id, 'done')}>Complete</button>
                      <button type="button" className="btn-chip" onClick={() => onStatus(a.id, 'dropped')}>Drop</button>
                    </>
                  ) : (
                    <button type="button" className="btn-chip" onClick={() => onStatus(a.id, 'open')}>Reopen</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
