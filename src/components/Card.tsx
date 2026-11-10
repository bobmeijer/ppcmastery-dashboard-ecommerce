'use client';

import { createContext, useContext, useState } from 'react';

// A child (DataTable) can place one control in the card header, next to the
// title, without the page wiring it (column icon top right).
const CardSlotContext = createContext<((node: React.ReactNode) => void) | null>(null);
export const useCardSlot = () => useContext(CardSlotContext);

// heading: replaces the title block when the left side needs more than text
// (Products: title plus bucket chips on one line with the search field).
export function Card({ title, subtitle, heading, actions, children, className = '' }: {
  title?: string; subtitle?: string; heading?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  const [slot, setSlot] = useState<React.ReactNode>(null);
  return (
    <CardSlotContext.Provider value={setSlot}>
      <section className={`card p-3.5 sm:p-4 lg:p-5 ${className}`}>
        {(title || heading || actions || slot) && (
          <header className={`mb-3 flex flex-wrap justify-between gap-x-3 gap-y-2 sm:mb-4 ${heading ? 'items-center' : 'items-start'}`}>
            {heading || (
              // Phones keep the table controls on the title row.
              <div className="min-w-0 flex-[1_1_10rem]">
                {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
                {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
              </div>
            )}
            {/* Phones: the wrapper dissolves so the table controls stay on the title row and
                the card's own actions (chips, search) take a full row under it. */}
            <div className="flex max-w-full flex-wrap items-center gap-2 max-sm:contents">
              {actions && <div className="flex max-w-full flex-wrap items-center gap-2 max-sm:order-2 max-sm:w-full">{actions}</div>}
              {slot && <div className="flex items-center gap-2 max-sm:order-1 max-sm:ml-auto">{slot}</div>}
            </div>
          </header>
        )}
        {children}
      </section>
    </CardSlotContext.Provider>
  );
}

export function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'bad' }) {
  const color = tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--gray-500)';
  return <p className="text-sm" style={{ color }}>{children}</p>;
}

// Placeholder bars breathe in colour, not opacity, and only show after a short wait so a
// fast load does not flash.
const ROW_WIDTHS = ['100%', '92%', '96%', '78%', '88%', '64%'];

export function SkeletonBar({ width, height = '0.75rem', className = '' }: { width: string; height?: string; className?: string }) {
  return <div className={`skeleton-bar ${className}`} style={{ width, height }} />;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <SkeletonBar key={i} width={ROW_WIDTHS[i % ROW_WIDTHS.length]} height="1.25rem" />)}
    </div>
  );
}
