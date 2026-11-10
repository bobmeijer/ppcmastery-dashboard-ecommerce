'use client';

// Status badges (lag, deviating) with an info icon that opens a short
// explanation. The popover is portalled with fixed positioning so it is not
// clipped by the scroll containers around tables.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScope } from '@/components/ScopeContext';
import { lagCutoff } from '@/lib/metrics';

// True when the selected period ends after the last complete day, i.e. it reaches
// into the conversion lag. Badges on tiles render only then, not per metric type.
export function usePeriodInLag(): boolean {
  const { range, lagDays } = useScope();
  return range.end > lagCutoff(lagDays);
}

const LAG_INFO = 'Figures that depend on conversions (revenue, purchases, ROAS, CPA, CVR) are still incomplete for the most recent days and will keep rising.';
// Appended to every lag text; the window is the account's lag setting.
const lagWindow = (days: number) => `Conversions usually arrive up to ${days} days after the click.`;
const ANOMALY_INFO = 'This period falls outside the expected band: more than 1.5 standard deviations above or below the average of the surrounding periods. A signal to look into, not an error.';

const POPOVER_WIDTH = 260;

export function InfoTip({ text, label }: { text: string; label: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => { if (e.target !== button.current && !button.current?.contains(e.target as Node)) setPos(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null); };
    const onScroll = () => setPos(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pos]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();   // badges sit inside sortable headers and clickable rows
    if (pos) return setPos(null);
    const r = button.current!.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - POPOVER_WIDTH / 2), window.innerWidth - POPOVER_WIDTH - 8);
    setPos({ top: r.bottom + 6, left });
  };

  return (
    <>
      <button ref={button} type="button" className="info-tip" aria-label={`What does ${label} mean?`} aria-expanded={!!pos} onClick={toggle}>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" />
        </svg>
      </button>
      {pos && createPortal(
        <div role="tooltip" className="info-popover" style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}>
          <div className="info-popover-title">{label}</div>
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}

// One lag flag everywhere: warning icon + "Conversion lag", no info
// icon; the explanation opens on hover or keyboard focus of the badge itself.
// size="bar" is the header version next to the period picker (top-bar height);
// size="inline" is the same badge at text size, for table rows and notes.
function LagFlag({ info, size }: { info: string; size: 'bar' | 'inline' }) {
  const { lagDays } = useScope();
  const text = `${info.replace(/\.?\s*$/, '.')} ${lagWindow(lagDays)}`;
  const tipId = useId();
  const badge = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const show = () => {
    const r = badge.current!.getBoundingClientRect();
    // The header flag sits near the right edge, so its tip aligns right; inline ones centre.
    const anchor = size === 'bar' ? r.right - POPOVER_WIDTH : r.left + r.width / 2 - POPOVER_WIDTH / 2;
    const left = Math.min(Math.max(8, anchor), window.innerWidth - POPOVER_WIDTH - 8);
    setPos({ top: r.bottom + 6, left });
  };
  const hide = () => setPos(null);
  const icon = size === 'bar' ? 14 : 12;
  return (
    <>
      <span ref={badge} className={`lag-badge lag-badge--flag cursor-help ${size === 'bar' ? 'topbar-control' : 'lag-badge--inline'}`}
        tabIndex={0} aria-describedby={pos ? tipId : undefined}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        // Touch has no hover: a tap toggles the explanation.
        onClick={e => { e.stopPropagation(); if (pos) hide(); else show(); }}>
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
        </svg>
        {/* Phones show the icon only in the top bar; the tip still names it. */}
        <span className={size === 'bar' ? 'max-sm:sr-only' : undefined}>Conversion lag</span>
      </span>
      {pos && createPortal(
        <div id={tipId} role="tooltip" className="info-popover" style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}>
          <div className="info-popover-title">Conversion lag</div>
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}

export function LagBadge({ info = LAG_INFO }: { info?: string }) {
  return <LagFlag info={info} size="inline" />;
}

export function ConversionLagBadge({ info = LAG_INFO }: { info?: string }) {
  return <LagFlag info={info} size="bar" />;
}

export function AnomalyBadge({ info = ANOMALY_INFO }: { info?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="lag-badge lag-badge--anomaly">anomaly</span>
      <InfoTip text={info} label="Anomaly" />
    </span>
  );
}
