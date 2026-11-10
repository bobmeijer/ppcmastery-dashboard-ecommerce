'use client';

// Top of the page (round-5 decision): page title left, filters next to it, one
// period button right. the period control is a single
// fixed-width button that opens a popover (presets, own dates, comparison), so
// switching to "Custom" never shifts the bar.
import { LOCALE } from '@/lib/config';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ConversionLagBadge, usePeriodInLag } from './Badges';
import { FilterBar, MobileFilters } from './FilterBar';
import { isAdminPath } from './AdminTabs';
import { Sheet } from './Sheet';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Icon } from './Icons';
import { pageTitle } from './nav';
import { CompareMode, Preset, PRESETS, useScope } from './ScopeContext';
import { isGoogleOnlyPath } from '@/lib/platform';
import { PlatformMark } from './PlatformMark';

const COMPARE: { value: CompareMode; label: string }[] = [
  { value: 'previous', label: 'Previous period' },
  { value: 'year', label: 'Previous year' },
  { value: 'none', label: 'No comparison' },
];

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
// Phones: '1-30 sep' within one month, else '28 aug - 3 sep'.
const fmtShort = (start: string, end: string) => start.slice(0, 7) === end.slice(0, 7)
  ? `${Number(start.slice(8))}-${fmt(end)}` : `${fmt(start)} - ${fmt(end)}`;
const fmtY = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function PeriodPicker() {
  const { preset, setPreset, range, setCustomRange, compare, setCompare, lagDays } = useScope();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);
  const ref = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  useEffect(() => { setDraft(range); }, [range]);
  useEffect(() => {
    if (!open || mobile) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, mobile]);

  const presetLabel = PRESETS.find(p => p.value === preset)?.label || '';
  const compareLabel = COMPARE.find(c => c.value === compare)?.label || '';
  const presets = PRESETS.filter(p => p.value !== 'custom');
  const choose = (value: Preset) => { setPreset(value); setOpen(false); };
  const applyCustom = () => { if (draft.start <= draft.end) { setCustomRange(draft); setOpen(false); } };

  const panel = (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.15fr_1fr] lg:gap-6">
            <div>
              <div className="eyebrow mb-2">Period</div>
              <div className="grid grid-cols-2 gap-1 lg:flex lg:flex-col lg:gap-0.5">
                {presets.map(p => (
                  <button key={p.value} type="button" onClick={() => choose(p.value)} className="rounded-md px-2.5 py-1.5 text-left hover:bg-paper-alt max-lg:py-2.5"
                    style={preset === p.value ? { background: 'var(--ink)', color: 'var(--paper)' } : undefined}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <div className="eyebrow mb-2">Custom period</div>
              <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-col">
                <label className="flex flex-col gap-1 text-muted">
                  <span className="text-xs">from</span>
                  <input type="date" value={draft.start} max={draft.end} onChange={e => setDraft({ ...draft, start: e.target.value })} aria-label="Start date" className="w-full" />
                </label>
                <label className="flex flex-col gap-1 text-muted">
                  <span className="text-xs">to</span>
                  <input type="date" value={draft.end} min={draft.start} onChange={e => setDraft({ ...draft, end: e.target.value })} aria-label="End date" className="w-full" />
                </label>
                <button type="button" className="btn-chip self-start max-lg:col-span-2 max-lg:h-10 max-lg:justify-center" data-active={preset === 'custom' || draft.start !== range.start || draft.end !== range.end} onClick={applyCustom} disabled={draft.start > draft.end}>Apply</button>
              </div>
            </div>
            <div className="border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <div className="eyebrow mb-2">Compare with</div>
              <div className="flex flex-col gap-0.5">
                {COMPARE.map(c => (
                  <button key={c.value} type="button" onClick={() => setCompare(c.value)} className="rounded-md px-2.5 py-1.5 text-left hover:bg-paper-alt max-lg:py-2.5"
                    style={compare === c.value ? { background: 'var(--ink)', color: 'var(--paper)' } : undefined}>
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">Previous period uses the same weekdays; for month, quarter and year it is the previous calendar unit.</p>
            </div>
          </div>
          <p className="mt-4 flex items-start gap-1.5 border-t border-line pt-3 text-xs text-muted">
            <Icon name="status" size={14} className="mt-0.5 shrink-0" />
            <span>Conversions arrive up to {lagDays} days after the click. The last {lagDays} days are shaded in charts and do not count towards goals or conversion comparisons.</span>
          </p>
        </>
  );

  // Phones: preset and short dates on one line, the
  // comparison lives in the sheet; the panel opens as a bottom sheet in one column.
  return (
    <div ref={ref} className="relative min-w-0 max-lg:flex-1">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Period and comparison"
        className="topbar-control w-full gap-3 border border-line bg-paper hover:border-gray-400">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-medium">{presetLabel}</span>
          <span className="num truncate text-muted"><span className="lg:hidden">{fmtShort(range.start, range.end)}</span><span className="max-lg:hidden">{fmt(range.start)} to {fmtY(range.end)}</span></span>
        </span>
        <span className="border-l border-line pl-3 text-muted max-lg:hidden">{compare === 'none' ? 'no comparison' : `vs ${compareLabel.toLowerCase()}`}</span>
        <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && !mobile && (
        <div className="absolute right-0 top-full z-20 mt-1 w-[720px] rounded-lg border border-line bg-paper p-4 text-sm" role="dialog" aria-label="Period">
          {panel}
        </div>
      )}
      <Sheet open={open && mobile} onClose={() => setOpen(false)} title="Period">{panel}</Sheet>
    </div>
  );
}

export function ScopeBar() {
  const pathname = usePathname();
  const title = pageTitle(pathname);
  const inLag = usePeriodInLag();
  const { platform } = useScope();
  return (
    <div className="border-b border-line bg-paper/95 backdrop-blur lg:sticky lg:top-0 lg:z-10">
      {/* Phones: the title sits in the shell's top bar; here one row with period, filters and lag flag. */}
      {/* Admin pages (Users, Status) have no period: no control row on phones. */}
      {!isAdminPath(pathname) && <div className="flex items-center gap-2 px-3 py-2 sm:px-4 lg:hidden">
        <PeriodPicker />
        <MobileFilters />
        {inLag && <ConversionLagBadge />}
      </div>}
      <div className="mx-auto hidden w-full max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:flex lg:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {/* Screenshots must say which platform they show; Google is the default and needs no mark.
              Logo only: a text chip pushed the period control onto a second line. */}
          {platform === 'microsoft' && !isGoogleOnlyPath(pathname) && <span title="Microsoft Ads" aria-label="Microsoft Ads" className="inline-flex items-center"><PlatformMark platform="microsoft" size={16} /></span>}
          <FilterBar />
        </div>
        {/* One lag flag for every conversion metric on the page, shown only
            when the period ends after the last complete day. */}
        <div className="flex items-center gap-3">
          {inLag && <ConversionLagBadge />}
          <PeriodPicker />
        </div>
      </div>
    </div>
  );
}
