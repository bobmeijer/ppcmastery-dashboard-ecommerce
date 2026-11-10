'use client';

import { LOCALE } from '@/lib/config';
import type { IssueSeverity } from '@/lib/feedShaping';

export const formatDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const availabilityLabel = (value: string | null) => {
  switch (value) {
    case 'IN_STOCK': return 'In stock';
    case 'OUT_OF_STOCK': return 'Out of stock';
    case 'PREORDER': return 'Pre-order';
    case 'BACKORDER': return 'Backorder';
    default: return 'Unknown';
  }
};

export const merchantStatusLabel = (value: string) => {
  switch (value) {
    case 'APPROVED': return 'Approved';
    case 'DISAPPROVED': return 'Disapproved';
    case 'PENDING': return 'Pending';
    default: return 'Unknown';
  }
};

// Small status chip, same radius family as the lag badge (4px), hairline instead of a fill so it
// stays inside the monochrome language; only the text carries the colour.
export function SeverityChip({ severity }: { severity: IssueSeverity }) {
  const blocking = severity === 'blocking';
  return (
    <span className="inline-block rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium leading-tight"
      style={{ borderColor: 'var(--line)', color: blocking ? 'var(--bad)' : 'var(--warn)' }}>
      {blocking ? 'Blocking' : 'Warning'}
    </span>
  );
}
