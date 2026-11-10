'use client';

// The analysis itself, the story of the current
// view (headline plus 3-4 points of evidence, interpretation labelled), the thinking
// state with the agent's steps, and Admin's edit and withdraw controls.
import { LOCALE, TIME_ZONE } from '@/lib/config';
import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useHrefWith } from '../pageLinks';
import { useScope } from '../ScopeContext';
import { addDays, accountToday, isoDate, lagCutoff, type DateRange } from '@/lib/metrics';
import { fmtDate } from '@/lib/meetingsShaping';
import { InsightLabel, SparkIcon } from './AiMarks';
import { SkeletonBar } from '../Card';
import { useAnalysis } from './AnalysisContext';
import type { Insight, StoryPoint } from './types';
import type { Source } from '@/lib/insightSources';

// The footer names exactly what was compared: the selected period, the comparison and
// the matured days for revenue.
function basisFor(range: DateRange, compare: string, lagDays: number, today: string) {
  const versus = compare === 'year' ? 'the same period last year' : compare === 'none' ? null : 'the previous period';
  const matured = [range.end, addDays(lagCutoff(lagDays), -1)].sort()[0];
  const complete = [range.end, addDays(today, -1)].sort()[0];
  const period = `${fmtDate(range.start)} to ${fmtDate(range.end)}`;
  const lag = matured < range.end ? ` Revenue and ROAS on matured days to ${fmtDate(matured, false)}, cost and clicks to ${fmtDate(complete, false)}.` : '';
  return `${period}${versus ? `, compared with ${versus}` : ''}.${lag}`;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

function Point({ point }: { point: StoryPoint }) {
  const hrefWith = useHrefWith();
  const interpretation = point.type === 'interpretation';
  const body = (
    <>
      <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full" style={{ background: interpretation ? 'var(--gray-400)' : 'var(--ink)' }} aria-hidden="true" />
      <p className="min-w-0 text-sm text-ink">
        {interpretation && <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-muted">Interpretation</span>}
        {point.text}
      </p>
      {point.link && <span className="text-muted transition-colors group-hover:text-ink" aria-hidden="true">&rsaquo;</span>}
    </>
  );
  const grid = 'grid grid-cols-[6px_1fr_auto] gap-x-3 rounded-md px-2 py-1.5 -mx-2';
  return (
    <li>
      {point.link
        ? <Link href={hrefWith(point.link.path, point.link.params)} className={`group ${grid} hover:bg-paper-alt`}>{body}</Link>
        : <div className={grid}>{body}</div>}
      {point.sources?.length ? <Sources sources={point.sources} /> : null}
    </li>
  );
}

// "Source" under a point: the data table it came from, opened with that
// period and filter, or the audit finding, note or meeting itself.
function Sources({ sources }: { sources: Source[] }) {
  const hrefWith = useHrefWith();
  const [open, setOpen] = useState(false);
  return (
    <div className="pl-[18px]">
      <button type="button" className="text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-ink" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? 'Hide source' : sources.length > 1 ? `Sources (${sources.length})` : 'Source'}
      </button>
      {open && (
        <ul className="mt-1 mb-1.5 space-y-1.5 border-l border-line pl-3">
          {sources.map((src, i) => (
            <li key={i} className="text-xs leading-relaxed">
              {src.kind === 'data'
                ? (src.path
                  ? <Link href={hrefWith(src.path, src.params ?? {})} className="text-ink underline decoration-dotted underline-offset-2 hover:decoration-solid">{src.label} &rsaquo;</Link>
                  : <span className="text-ink">{src.label}</span>)
                : <>
                    <span className="font-medium text-ink">{src.source}{src.date ? `, ${fmtDate(src.date)}` : ''}</span>
                    <span className="block text-muted">{src.text}</span>
                  </>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Admin's edit plus an optional lesson: the note goes into the prompts as an example
// (readCorrections), so the AI writes it his way next time.
function Editor({ story, onSave, onCancel }: { story: Insight['story']; onSave: (s: Insight['story'], note: string) => void; onCancel: () => void }) {
  const [headline, setHeadline] = useState(story.headline);
  const [points, setPoints] = useState(story.points);
  const [note, setNote] = useState('');
  const field = 'w-full rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm focus:border-subtle focus:outline-none';
  return (
    <div className="space-y-3">
      <textarea className={`${field} font-medium`} rows={2} value={headline} onChange={e => setHeadline(e.target.value)} aria-label="Headline" />
      {points.map((p, i) => (
        <textarea key={i} className={field} rows={2} value={p.text} aria-label={`Point ${i + 1}`}
          onChange={e => setPoints(ps => ps.map((q, j) => (j === i ? { ...q, text: e.target.value } : q)))} />
      ))}
      <textarea className={field} rows={2} value={note} onChange={e => setNote(e.target.value)} aria-label="Lesson for the AI"
        placeholder="What should the AI learn from this? (optional, for example: always mention the conversion delay for October)" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-chip" data-active="true" onClick={() => onSave({ headline, points: points.filter(p => p.text.trim()) }, note.trim())}>Save as Analysis by Admin</button>
        <button type="button" className="btn-chip" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function Thinking({ steps, lines = 3 }: { steps: string[]; lines?: number }) {
  return (
    <div className="skeleton space-y-3" aria-busy="true" aria-label="Thinking">
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted" aria-live="polite">
        <SparkIcon size={13} />Thinking...{steps.length > 0 && <span className="text-subtle">{steps[steps.length - 1]}</span>}
      </p>
      {['90%', '72%', '84%'].slice(0, lines).map(w => <SkeletonBar key={w} width={w} height="1rem" />)}
    </div>
  );
}

// One-line status for launchers and strips: what the analysis is doing right now.
export function useAnalysisStatus() {
  const { state, steps } = useAnalysis();
  if (state === 'thinking') return `Thinking... ${steps[steps.length - 1] ?? ''}`.trim();
  if (state === 'waiting') return 'Thinking...';
  if (state === 'error') return 'Analysis unavailable';
  if (state === 'hidden') return 'No analysis';
  return 'Analysis ready';
}

export function AnalysisView() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const { range, compare, lagDays } = useScope();
  const { state, steps, insight, source, error, refresh, update, asClient, setAsClient } = useAnalysis();
  const [editing, setEditing] = useState(false);
  const today = isoDate(accountToday());

  if (state === 'hidden') return null;
  if (state === 'error' && !insight) return isAdmin ? <p className="text-sm text-muted">Analysis unavailable: {error}</p> : null;
  if (!insight) return <Thinking steps={steps} />;
  if (insight.status === 'hidden' && !isAdmin) return null;
  const hidden = insight.status === 'hidden';

  return (
    <div style={hidden ? { opacity: 0.55 } : undefined}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <InsightLabel status={insight.status} />
          {isAdmin && source === 'fallback' && <span className="eyebrow">Without AI text</span>}
          {source === 'demo' && <span className="eyebrow">Pre-generated example. Figures can differ slightly from the page</span>}
          {hidden && <span className="eyebrow" style={{ color: 'var(--warn)' }}>Withdrawn</span>}
        </div>
        {isAdmin && !editing && (
          // Admin edits and withdraws the client version: his own may use the Admin-only data.
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-chip" data-active={asClient} onClick={() => setAsClient(!asClient)} title="Show exactly what the client sees">Client version</button>
            {asClient && !hidden && <button type="button" className="btn-chip" onClick={() => setEditing(true)}>Edit</button>}
            {asClient && <button type="button" className="btn-chip" onClick={() => {
              // A withdrawal asks why: that reason is what the AI learns from it.
              if (hidden) { update({ status: 'auto' }); return; }
              const note = window.prompt('Why are you withdrawing this analysis? This teaches the AI for next time (optional).') ?? undefined;
              update({ status: 'hidden', ...(note !== undefined ? { note: note.trim() } : {}) });
            }}>{hidden ? 'Restore' : 'Withdraw'}</button>}
          </div>
        )}
      </div>

      {editing ? (
        <Editor story={insight.story} onCancel={() => setEditing(false)} onSave={(story, note) => { update({ story, ...(note ? { note } : {}) }); setEditing(false); }} />
      ) : (
        <>
          <p className="text-[15px] font-medium leading-snug text-ink">{insight.story.headline}</p>
          {insight.story.points.length > 0 && <ul className="mt-3 space-y-0.5">{insight.story.points.map((p, i) => <Point key={i} point={p} />)}</ul>}
        </>
      )}

      <div className="mt-3 space-y-2 border-t border-line pt-3 text-xs text-muted">
        <p>{basisFor(range, compare, lagDays, today)}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{insight.status === 'approved' ? 'Edited by Admin' : 'Generated automatically'} on {fmtTime(insight.generatedAt)}{isAdmin && (asClient ? ', client version' : ', your version')}</span>
          {isAdmin && error && <span style={{ color: 'var(--bad)' }}>{error}</span>}
          {isAdmin && (state === 'thinking' || state === 'waiting'
            ? <span className="inline-flex items-center gap-1.5"><SparkIcon size={13} />Thinking...</span>
            : <button type="button" onClick={refresh} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline"><SparkIcon size={13} />Re-run analysis</button>)}
        </div>
      </div>
    </div>
  );
}
