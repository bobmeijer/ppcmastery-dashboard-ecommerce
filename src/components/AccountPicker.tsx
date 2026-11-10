'use client';

// Account picker: one button at the top of
// the sidebar carries the whole context, label logo plus the platform underneath.
// The popover lists every label with Google Ads and Microsoft Ads; a platform
// without campaigns is greyed ("no campaigns yet") and shows up by itself with
// its first spend (/api/report/platforms). Pages that only have Google data
// (feed, auction insights) show Google Ads and keep the Microsoft rows locked.
// Radii follow the design: button 8px like nav items, popover 10px like cards, rows 6px.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePlatforms } from '@/hooks/usePlatforms';
import { isGoogleOnlyPath, Platform, PLATFORM_OPTIONS } from '@/lib/platform';
import { BrandLogo } from './BrandLogo';
import { PlatformMark } from './PlatformMark';
import { SCOPES, useScope } from './ScopeContext';

const LABELS = SCOPES.map(s => s.value);
const platformName = (p: Platform) => PLATFORM_OPTIONS.find(o => o.value === p)?.label || p;

export function AccountPicker() {
  const { scope, platform: selected, setContext } = useScope();
  const googleOnly = isGoogleOnlyPath(usePathname());
  const platform: Platform = googleOnly ? 'google' : selected;
  const available = usePlatforms(LABELS);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={`Account: ${SCOPES.find(s => s.value === scope)?.label}, ${platformName(platform)}`}
        className="flex w-full items-center gap-3 rounded-[8px] border border-line bg-paper px-3 py-2.5 text-left hover:border-gray-400">
        <span className="min-w-0 flex-1">
          <BrandLogo scope={scope} height={22} maxWidth={150} />
          <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted"><PlatformMark platform={platform} size={12} />{platformName(platform)}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-[10px] border border-line bg-paper p-1.5" role="dialog" aria-label="Choose account">
          {SCOPES.map((s, index) => (
            <div key={s.value} className={index > 0 ? 'mt-1 border-t border-line pt-1' : ''}>
              <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted">{s.label}</div>
              {PLATFORM_OPTIONS.map(({ value: p }) => {
                const hasData = available[s.value].includes(p);
                const locked = !hasData || (googleOnly && p === 'microsoft');
                const active = s.value === scope && p === platform;
                return (
                  <button key={p} type="button" disabled={locked} onClick={() => { setContext(s.value, p); setOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-paper-alt disabled:cursor-not-allowed disabled:opacity-40"
                    style={active ? { background: 'var(--ink)', color: 'var(--paper)' } : undefined}
                    title={hasData && googleOnly && p === 'microsoft' ? 'This page only has Google Ads data' : undefined}>
                    <PlatformMark platform={p} />
                    <span className="flex-1">{platformName(p)}</span>
                    {!hasData && <span className="text-[11px]">no campaigns yet</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
