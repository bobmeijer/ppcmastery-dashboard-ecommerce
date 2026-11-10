'use client';

import { LOCALE } from '@/lib/config';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCardSlot } from './Card';
import { Icon } from './Icons';
import { Sheet } from './Sheet';
import { useIsPhone } from '@/hooks/useIsMobile';
import { change, fmtPercent } from '@/lib/metrics';

export interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string | null;
  csv?: (row: T) => string | number | null;   // kept for callers
  hidden?: boolean;                            // not shown until the reader switches it on
  // Phones (< 640px): hidden by default so a table shows its
  // first column plus the few that answer the page's question. A saved column choice wins.
  mobileHidden?: boolean;
  // Comparison mode: with the table's
  // "Compare" toggle on, the cell shows the value and under it the previous
  // value with the signed absolute and percentage difference.
  // higherIsBetter: true (default) or false colours the delta; null keeps it neutral (shares, counts without a direction).
  // deltaFormat: how the absolute difference is shown; defaults to `format` (ratios and percentages pass a points formatter).
  compare?: { previous: (row: T) => number | null; format: (v: number | null) => string; deltaFormat?: (v: number) => string; higherIsBetter?: boolean | null };
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  csvName?: string;      // legacy name; now only the default storage key for the column choices
  maxRows?: number;
  footer?: T;
  variant?: string;
  storageKey?: string;   // column choices persist per table in localStorage under this key
  compareLabel?: string; // e.g. 'previous period'; enables the Compare toggle when a column has `compare`
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
}

interface ColumnPrefs { order: string[]; hidden: string[] }

const prefsKey = (key: string) => `table-columns:${key}`;
const compareKey = (key: string) => `table-compare:${key}`;

function readPrefs(key: string | undefined): ColumnPrefs | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(prefsKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ColumnPrefs;
    return Array.isArray(parsed.order) && Array.isArray(parsed.hidden) ? parsed : null;
  } catch { return null; }
}

function writePrefs(key: string | undefined, prefs: ColumnPrefs | null) {
  if (!key) return;
  try { if (prefs) localStorage.setItem(prefsKey(key), JSON.stringify(prefs)); else localStorage.removeItem(prefsKey(key)); } catch { /* ignore */ }
}

const readCompare = (key: string | undefined) => { if (!key) return false; try { return localStorage.getItem(compareKey(key)) === '1'; } catch { return false; } };
const writeCompare = (key: string | undefined, on: boolean) => { if (!key) return; try { if (on) localStorage.setItem(compareKey(key), '1'); else localStorage.removeItem(compareKey(key)); } catch { /* ignore */ } };

const defaultPrefs = <T,>(columns: Column<T>[], phone = false): ColumnPrefs => ({ order: columns.map(c => c.key), hidden: columns.filter(c => c.hidden || (phone && c.mobileHidden)).map(c => c.key) });

// Effective order and visibility: saved choices win, unknown columns land at the end with their default.
function effective<T>(columns: Column<T>[], prefs: ColumnPrefs | null, phone = false): ColumnPrefs {
  const base = defaultPrefs(columns, phone);
  if (!prefs) return base;
  const known = prefs.order.filter(k => columns.some(c => c.key === k));
  const rest = base.order.filter(k => !known.includes(k));
  const hidden = [...prefs.hidden.filter(k => columns.some(c => c.key === k)), ...rest.filter(k => base.hidden.includes(k))];
  return { order: [...known, ...rest], hidden };
}

const arrange = <T,>(columns: Column<T>[], prefs: ColumnPrefs): Column<T>[] =>
  prefs.order.map(k => columns.find(c => c.key === k)!).filter(c => !prefs.hidden.includes(c.key));

// Column chooser: an icon in the card header opens a list
// to toggle columns and drag them into order; "Default" resets.
function ColumnChooser<T>({ columns, prefs, custom, onChange }: { columns: Column<T>[]; prefs: ColumnPrefs; custom: boolean; onChange: (p: ColumnPrefs | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Phones get the list in a sheet with up/down buttons: touch has no HTML5 drag.
  const phone = useIsPhone();
  useEffect(() => {
    if (!open || phone) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, phone]);

  const visibleCount = prefs.order.length - prefs.hidden.length;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = (target: string) => {
    if (!dragging || dragging === target) { setDragging(null); setOver(null); return; }
    const next = prefs.order.filter(k => k !== dragging);
    next.splice(next.indexOf(target), 0, dragging);
    onChange({ order: next, hidden: prefs.hidden });
    setDragging(null); setOver(null);
  };
  const move = (key: string, by: -1 | 1) => {
    const next = [...prefs.order];
    const i = next.indexOf(key);
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ order: next, hidden: prefs.hidden });
  };
  const toggle = (key: string, on: boolean) => {
    if (!on && visibleCount <= 1) return;
    onChange({ order: prefs.order, hidden: on ? prefs.hidden.filter(k => k !== key) : [...prefs.hidden, key] });
  };
  const footer = (
    <div className="flex items-center justify-between text-xs text-muted">
      <span>{visibleCount} of {prefs.order.length} columns{phone ? '' : ', drag to reorder'}</span>
      {custom && <button type="button" className="underline" onClick={() => onChange(null)}>Default</button>}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button type="button" className="flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-paper-alt hover:text-ink sm:h-7 sm:w-7" onClick={() => setOpen(o => !o)}
        aria-expanded={open} aria-label="Edit columns" title="Edit columns" data-active={custom}>
        <Icon name="columns" size={16} />
      </button>
      <Sheet open={open && phone} onClose={() => setOpen(false)} title="Columns" footer={footer}>
        {prefs.order.map((key, i) => {
          const column = columns.find(c => c.key === key)!;
          const on = !prefs.hidden.includes(key);
          return (
            <div key={key} className="flex min-h-[2.75rem] items-center gap-2 border-b border-line last:border-b-0">
              <label className="flex min-w-0 flex-1 items-center gap-3 py-2">
                <input type="checkbox" className="h-5 w-5" checked={on} onChange={e => toggle(key, e.target.checked)} />
                <span className="min-w-0 flex-1 truncate" style={on ? undefined : { color: 'var(--gray-500)' }}>{column.label}</span>
              </label>
              <button type="button" className="flex h-10 w-10 items-center justify-center rounded-md text-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(key, -1)} aria-label={`Move ${column.label} up`}><Icon name="up" size={16} /></button>
              <button type="button" className="flex h-10 w-10 items-center justify-center rounded-md text-muted disabled:opacity-30" disabled={i === prefs.order.length - 1} onClick={() => move(key, 1)} aria-label={`Move ${column.label} down`}><Icon name="down" size={16} /></button>
            </div>
          );
        })}
      </Sheet>
      {open && !phone && (
        <div className="absolute right-0 top-full z-20 mt-1 w-[300px] rounded-lg border border-line bg-paper p-2 text-sm text-ink" role="dialog" aria-label="Edit columns">
          <div className="max-h-80 overflow-y-auto">
            {prefs.order.map(key => {
              const column = columns.find(c => c.key === key)!;
              const on = !prefs.hidden.includes(key);
              return (
                <div key={key} draggable onDragStart={() => setDragging(key)} onDragOver={e => { e.preventDefault(); if (over !== key) setOver(key); }}
                  onDragLeave={() => { if (over === key) setOver(null); }} onDrop={e => { e.preventDefault(); drop(key); }} onDragEnd={() => { setDragging(null); setOver(null); }}
                  className="flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1 hover:bg-paper-alt"
                  style={{ opacity: dragging === key ? 0.4 : 1, boxShadow: over === key && dragging !== key ? 'inset 0 2px 0 var(--accent)' : undefined }}>
                  <span className="text-subtle" aria-hidden title="Drag to move"><Icon name="grip" size={14} /></span>
                  <input type="checkbox" className="h-4 w-4" checked={on} aria-label={column.label}
                    onChange={e => toggle(key, e.target.checked)} />
                  <span className="min-w-0 flex-1 truncate" style={on ? undefined : { color: 'var(--gray-500)' }}>{column.label}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-1 border-t border-line px-1.5 pt-2">{footer}</div>
        </div>
      )}
    </div>
  );
}

// A numeric cell in comparison mode: value, then previous value and the signed delta.
function CompareCell<T>({ column, row }: { column: Column<T>; row: T }) {
  const cmp = column.compare!;
  const previous = cmp.previous(row);
  const current = column.sortValue ? column.sortValue(row) : null;
  const cur = typeof current === 'number' ? current : null;
  const d = change(cur, previous);
  const higherIsBetter = cmp.higherIsBetter === undefined ? true : cmp.higherIsBetter;
  const good = d === null || higherIsBetter === null ? null : higherIsBetter ? d >= 0 : d <= 0;
  const abs = cur !== null && previous !== null ? cur - previous : null;
  return (
    <div className="leading-tight">
      <div>{column.render(row)}</div>
      <div className="mt-0.5 text-[11px] text-muted">
        <span>{cmp.format(previous)}</span>
        {abs !== null && d !== null && (
          <span className="ml-1.5" style={good === null ? undefined : { color: good ? 'var(--good)' : 'var(--bad)' }}>{abs >= 0 ? '+' : '-'}{cmp.deltaFormat ? cmp.deltaFormat(Math.abs(abs)) : cmp.format(Math.abs(abs))} ({d >= 0 ? '+' : ''}{fmtPercent(d)})</span>
        )}
      </div>
    </div>
  );
}

export function DataTable<T>({ rows, columns, rowKey, defaultSort, csvName, maxRows, footer, variant, storageKey, compareLabel, onRowClick, selectedKey }: Props<T>) {
  const [sort, setSort] = useState(defaultSort || null);
  const [expanded, setExpanded] = useState(false);
  const key = storageKey || csvName;
  const [saved, setSaved] = useState<ColumnPrefs | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  useEffect(() => { setSaved(readPrefs(key)); setCompareOn(readCompare(key)); }, [key]);
  const phone = useIsPhone();
  const prefs = useMemo(() => effective(columns, saved, phone), [columns, saved, phone]);
  const shown = useMemo(() => arrange(columns, prefs), [columns, prefs]);
  const update = (next: ColumnPrefs | null) => { setSaved(next); writePrefs(key, next); };
  const canCompare = columns.some(c => c.compare);
  const comparing = canCompare && compareOn;
  const toggleCompare = () => { setCompareOn(v => { writeCompare(key, !v); return !v; }); };

  // The controls go into the surrounding card header; without a card they sit above the table.
  const setSlot = useCardSlot();
  const controls = (
    <>
      {canCompare && (
        <button type="button" className="btn-chip" data-active={comparing} onClick={toggleCompare} title={`Show values for ${compareLabel || 'the comparison period'} and the difference`}>
          Compare
        </button>
      )}
      {key && <ColumnChooser columns={columns} prefs={prefs} custom={saved !== null} onChange={update} />}
    </>
  );
  useEffect(() => {
    if (!setSlot) return;
    setSlot(controls);
    return () => setSlot(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSlot, columns, prefs, saved, key, comparing, canCompare, compareLabel, phone]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find(c => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const value = column.sortValue;
    return [...rows].sort((a, b) => {
      const va = value(a); const vb = value(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), LOCALE);
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const visible = maxRows && !expanded ? sorted.slice(0, maxRows) : sorted;
  const cell = (c: Column<T>, row: T) => (comparing && c.compare ? <CompareCell column={c} row={row} /> : c.render(row));

  return (
    <div>
      {!setSlot && (canCompare || key) && <div className="mb-2 flex items-center justify-end gap-2">{controls}</div>}
      <div className="table-scroll overflow-x-auto">
        <table className="data" data-variant={variant} data-compare={comparing || undefined}>
          <thead>
            <tr>
              {shown.map(c => (
                <th key={c.key} className={c.numeric ? 'num' : ''} data-sortable={!!c.sortValue} data-sorted={sort?.key === c.key}
                  onClick={() => c.sortValue && setSort(prev => ({ key: c.key, direction: prev?.key === c.key && prev.direction === 'desc' ? 'asc' : 'desc' }))}>
                  <span className={`inline-flex items-center gap-1 ${c.numeric ? 'flex-row-reverse' : ''}`}>
                    <span>{c.label}</span>
                    {sort?.key === c.key && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                        style={{ transform: sort.direction === 'asc' ? 'rotate(180deg)' : undefined }}>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const k = rowKey(row);
              return (
                <tr key={k} onClick={onRowClick ? () => onRowClick(row) : undefined} data-selected={selectedKey === k || undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}>
                  {shown.map(c => <td key={c.key} className={c.numeric ? 'num' : ''}>{cell(c, row)}</td>)}
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={shown.length} className="text-muted">No data for this period.</td></tr>}
          </tbody>
          {footer && (
            <tfoot>
              <tr className="font-medium">
                {shown.map(c => <td key={c.key} className={`${c.numeric ? 'num' : ''} border-t border-line`}>{cell(c, footer)}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {maxRows && sorted.length > maxRows && (
        <div className="mt-3 text-xs text-muted">
          <button type="button" className="underline max-sm:py-3" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Show less' : `Show all ${sorted.length} rows`}
          </button>
        </div>
      )}
    </div>
  );
}
