'use client';

// Bottom sheet for phones: popovers that are wider
// than the screen (period, filters, column chooser) open here instead. Backdrop,
// Escape and a locked page scroll; the content scrolls inside the sheet.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';

export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="sheet-backdrop absolute inset-0" onClick={onClose} />
      <div className="sheet-panel relative flex max-h-[88dvh] flex-col rounded-t-[14px] bg-paper text-sm text-ink">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-md text-muted hover:text-ink"><Icon name="close" size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
