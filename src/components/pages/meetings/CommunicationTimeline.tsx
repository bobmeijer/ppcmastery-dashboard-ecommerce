'use client';

// One timeline for meetings and email threads (Communication, 2026-10-21). Every card
// is a digest: summary, decisions and the actions it produced. Meetings fold
// out to the full note; email threads never show raw mail. Admins see hidden items
// greyed out and can hide or show any item.
import { BRAND } from '@/lib/config';
import { useMemo, useState } from 'react';
import { Card, Notice } from '@/components/Card';
import { Action, Communication, CommunicationKind, cleanTitle, fmtDate, parseMarkdown } from '@/lib/meetingsShaping';
import { Blocks } from './Markdown';
import { Avatar, LabelTag } from './ActionBoard';

export const itemAnchor = (id: string) => `item-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

type KindFilter = 'all' | CommunicationKind;
const FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'email', label: 'Email' },
];

function KindTag({ item }: { item: Communication }) {
  const text = item.kind === 'meeting' ? 'Meeting' : item.message_count > 1 ? `Email, ${item.message_count} messages` : 'Email';
  return <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-[11px] text-ink-soft">{text}</span>;
}

function Item({ item, actions, admin, onHidden }: {
  item: Communication; actions: Action[]; admin: boolean; onHidden: (id: string, hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => parseMarkdown(item.summary_md), [item.summary_md]);
  // The full note without its H1 title (the card already shows it).
  const detail = useMemo(() => (item.detail_md ? parseMarkdown(item.detail_md).filter(b => !(b.type === 'heading' && b.level === 1)) : []), [item.detail_md]);
  return (
    <li id={itemAnchor(item.id)} className="relative pl-6 scroll-mt-24" style={item.hidden ? { opacity: 0.55 } : undefined}>
      <span aria-hidden className="absolute left-0 top-[0.45rem] h-2.5 w-2.5 rounded-full border-2 border-paper"
        style={{ background: item.kind === 'meeting' ? 'var(--accent)' : 'var(--gray-400)' }} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="num text-sm font-semibold">{fmtDate(item.date)}</span>
          {item.time && <span className="ml-2 text-sm text-muted">{item.time}</span>}
          <span className="ml-2 text-sm text-ink">{cleanTitle(item.title)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <KindTag item={item} />
          {item.labels.map(l => <LabelTag key={l} label={l} />)}
          {item.hidden && <span style={{ color: 'var(--warn)' }}>hidden from {BRAND.client}</span>}
          {admin && (
            <button type="button" className="btn-chip" onClick={() => onHidden(item.id, !item.hidden)}>{item.hidden ? 'Show' : 'Hide'}</button>
          )}
        </div>
      </div>
      {item.participants.length > 0 && <div className="mt-0.5 text-xs text-muted">{item.participants.join(', ')}</div>}
      <div className="mt-2 space-y-3">
        {summary.length > 0 ? <Blocks blocks={summary} compact /> : <Notice tone="info">No summary available.</Notice>}
        {item.decisions.length > 0 && (
          <div>
            <div className="eyebrow mb-1">Decisions</div>
            <ul className="space-y-1">
              {item.decisions.map((d, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-soft">
                  <span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full" style={{ background: 'var(--ink)' }} />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {actions.length > 0 && (
          <div>
            <div className="eyebrow mb-1">Actions</div>
            <ul className="space-y-1.5">
              {actions.map(a => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <Avatar owner={a.owner} />
                  <span className={a.status === 'open' ? 'text-ink-soft' : 'text-muted line-through decoration-[var(--gray-300)]'}>{a.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {detail.length > 0 && (
          <>
            {/* Touch: a taller hit area without moving the text. */}
            <button type="button" className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline max-lg:-mb-3 max-lg:pb-3 max-lg:pt-3 max-lg:-mt-1" aria-expanded={open} onClick={() => setOpen(o => !o)}>
              {open ? 'Hide full note' : 'Show full note'}
            </button>
            {open && (
              <div className="rounded-[8px] border border-line bg-paper-alt/60 p-4">
                <Blocks blocks={detail} />
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function CommunicationTimeline({ items, actions, admin, onHidden }: {
  items: Communication[]; actions: Action[]; admin: boolean; onHidden: (id: string, hidden: boolean) => void;
}) {
  const [filter, setFilter] = useState<KindFilter>('all');
  const bySource = useMemo(() => {
    const map: Record<string, Action[]> = {};
    for (const a of actions) (map[a.source_id] ||= []).push(a);
    return map;
  }, [actions]);
  const shown = items.filter(i => filter === 'all' || i.kind === filter);
  return (
    <Card title="Timeline" subtitle={`Meetings and email, newest first. Every email thread is summarised; the timeline covers all of ${BRAND.client}.`}
      actions={(
        <div className="flex items-center gap-1" role="tablist">
          {FILTERS.map(f => (
            <button key={f.value} type="button" role="tab" aria-selected={filter === f.value} className="btn-chip" data-active={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      )}>
      {shown.length === 0 && <Notice tone="warn">{items.length === 0 ? 'No meetings or email yet.' : 'Nothing in this selection.'}</Notice>}
      {shown.length > 0 && (
        <ol className="relative space-y-7 before:absolute before:bottom-1 before:left-[4px] before:top-2 before:w-px before:bg-line">
          {shown.map(i => <Item key={i.id} item={i} actions={bySource[i.id] || []} admin={admin} onHidden={onHidden} />)}
        </ol>
      )}
    </Card>
  );
}
