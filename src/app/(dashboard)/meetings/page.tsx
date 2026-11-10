'use client';

// Communication: meetings and email threads as digests, from the Supabase
// communications and actions tables (migration 0004). Top to bottom: count line,
// action board, timeline. Admins can hide an item from the client.
import { BRAND } from '@/lib/config';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Notice } from '@/components/Card';
import { MeetingsSkeleton } from '@/components/PageSkeletons';
import { useScope } from '@/components/ScopeContext';
import { useSetFreshness } from '@/components/FreshnessContext';
import { useMeetings } from '@/hooks/useMeetings';
import { ActionStatus, Communication, fmtDate, headerCounts, nextMeeting, todayIso } from '@/lib/meetingsShaping';
import { ActionBoard } from '@/components/pages/meetings/ActionBoard';
import { CommunicationTimeline, itemAnchor } from '@/components/pages/meetings/CommunicationTimeline';

function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-[8px] px-4 py-2 text-sm shadow-none"
      style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
      {message}
    </div>
  );
}

function CountLine({ admin, client, total, next }: { admin: number; client: number; total: number; next: { date: string; time: string | null } | null }) {
  const today = todayIso();
  const nextText = next
    ? `${next.date === today ? 'today' : fmtDate(next.date)}${next.time ? ` ${next.time}` : ''}`
    : 'not set';
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-soft">
      <span><span className="num font-semibold text-ink">{admin}</span> open for {BRAND.accountManager}</span>
      <span><span className="num font-semibold text-ink">{client}</span> open for {BRAND.client}</span>
      <span className="text-muted"><span className="num">{total}</span> open in total</span>
      <span className="text-muted max-sm:w-full sm:ml-auto">Next meeting: <span className="text-ink">{nextText}</span></span>
    </div>
  );
}

export default function MeetingsPage() {
  const { scope } = useScope();
  const { data, error, loading } = useMeetings();
  const [overrides, setOverrides] = useState<Record<string, ActionStatus>>({});
  const [hiddenOverrides, setHiddenOverrides] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const today = todayIso();

  // Overrides hold saved changes until the next load; switching account reloads.
  useEffect(() => { setOverrides({}); setHiddenOverrides({}); }, [scope]);

  const items = useMemo<Communication[]>(() => (data ? data.items.map(i => (i.id in hiddenOverrides ? { ...i, hidden: hiddenOverrides[i.id] } : i)) : []), [data, hiddenOverrides]);
  const newest = items.length ? items[0].date : null;
  useSetFreshness(newest);

  const counts = useMemo(() => (data ? headerCounts(data.actions, scope, overrides) : null), [data, scope, overrides]);
  const next = useMemo(() => nextMeeting(items), [items]);

  // Optimistic: the board moves the action at once and moves it back if the save fails.
  const onStatus = useCallback((id: string, status: ActionStatus) => {
    let previous: ActionStatus | undefined;
    setOverrides(prev => { previous = prev[id]; return { ...prev, [id]: status }; });
    fetch('/api/report/meetings/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed (${response.status})`);
        setToast('Status saved.');
      })
      .catch(err => {
        setOverrides(prev => {
          const next = { ...prev };
          if (previous === undefined) delete next[id]; else next[id] = previous;
          return next;
        });
        setToast(`Status not saved: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []);
  // Same optimistic pattern for hiding an item (admins only; the route refuses clients).
  const onHidden = useCallback((id: string, hidden: boolean) => {
    setHiddenOverrides(prev => ({ ...prev, [id]: hidden }));
    fetch('/api/report/meetings/hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, hidden }),
    })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed (${response.status})`);
        setToast(hidden ? `Hidden from ${BRAND.client}.` : `Visible to ${BRAND.client} again.`);
      })
      .catch(err => {
        setHiddenOverrides(prev => ({ ...prev, [id]: !hidden }));
        setToast(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);
  const source = useCallback((id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return null;
    return { href: `#${itemAnchor(id)}`, text: `${item.kind === 'meeting' ? 'meeting' : 'email'} ${fmtDate(item.date)}` };
  }, [items]);

  return (
    <div className="space-y-[var(--page-gap)]">
      {error && <Notice tone="bad">Communication could not be loaded: {error}</Notice>}
      {loading && !data && <MeetingsSkeleton />}
      {data && <Notice tone="info">Sample content: the meetings, emails and actions on this page are fictional.</Notice>}
      {data && counts && <CountLine admin={counts.admin} client={counts.client} total={counts.total} next={next} />}
      {data && items.length === 0 && data.actions.length === 0 && <Notice tone="warn">No meetings, email or actions for this account yet.</Notice>}
      {data && <ActionBoard actions={data.actions} scope={scope} today={today} overrides={overrides} onStatus={onStatus} source={source} />}
      {data && <CommunicationTimeline items={items} actions={data.actions} admin={data.role === 'admin'} onHidden={onHidden} />}
      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
