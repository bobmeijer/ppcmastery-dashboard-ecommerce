'use client';

// Inline marks for the AI panels, kept here so Icons.tsx (which differs per dashboard)
// stays untouched and the feature cherry-picks cleanly.
import type { InsightStatus } from './types';

export function SparkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

export function SendIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h13" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}

// "AI analysis" until Admin approves or edits; then "Reviewed analysis".
export function InsightLabel({ status }: { status: InsightStatus }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-base font-semibold tracking-tight">Reviewed analysis</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ink text-paper"><SparkIcon size={13} /></span>
      <span className="text-base font-semibold tracking-tight">AI analysis</span>
    </span>
  );
}
