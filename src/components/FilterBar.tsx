'use client';

// Campaign, network and category filters in the top bar. Order: status, category, campaign,
// network. Dropdown buttons; the campaign dropdown carries the "Exclude brand" quick
// switch at the top. State lives in the URL through ScopeContext.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { facets, STATUS_OPTIONS } from '@/lib/filters';
import { TypeFilter, TypeOption, typeName } from '@/lib/productTypes';
import { useFilterOptions } from './FilterOptionsContext';
import { useScope } from './ScopeContext';
import { Icon } from './Icons';
import { SkeletonBar } from './Card';
import { Sheet } from './Sheet';

// Inside the phone sheet every dropdown renders as an expandable section in the flow
// instead of a popover.
const InlineContext = createContext(false);

function Dropdown({ label, count, children, width = 340 }: { label: string; count: number; children: React.ReactNode; width?: number }) {
  const inline = useContext(InlineContext);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || inline) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, inline]);
  if (inline) return (
    <div className="border-b border-line py-1 last:border-b-0">
      <button type="button" className="flex h-11 w-full items-center gap-2 text-left text-sm font-medium" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="flex-1">{label}</span>
        {count > 0 && <span className="num rounded-full bg-ink px-1.5 text-[11px] leading-5 text-paper">{count}</span>}
        <Icon name={open ? 'up' : 'down'} size={16} className="text-muted" />
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn-chip topbar-control gap-1.5" data-active={count > 0} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>{label}</span>
        {count > 0 && <span className="num rounded-full px-1.5 text-[11px]" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>{count}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-paper p-2" style={{ width }} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

const Check = ({ checked, onChange, children, muted }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; muted?: boolean }) => (
  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-paper-alt max-lg:min-h-[2.5rem]" style={muted ? { color: 'var(--gray-500)' } : undefined}>
    <input type="checkbox" className="h-4 w-4" checked={checked} onChange={e => onChange(e.target.checked)} />
    <span className="min-w-0 flex-1 truncate">{children}</span>
  </label>
);

// Product type filter: level 1 with the account default
// (types in product_type_exclusions start unchecked), level 2 only for the
// checked level 1 types. Empty level 2 selection = all of them.
function ProductTypeFilter({ options, value, onChange }: { options: TypeOption[]; value: TypeFilter; onChange: (v: TypeFilter) => void }) {
  const defaultL1 = options.filter(o => !o.excludedByDefault).map(o => o.l1);
  const checkedL1 = value.l1 === null ? defaultL1 : value.l1.length === 0 ? options.map(o => o.l1) : value.l1;
  const l2Options = options.filter(o => checkedL1.includes(o.l1)).flatMap(o => o.l2.map(x => ({ ...x, l1: o.l1 })));
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(v => b.includes(v));

  const setL1 = (next: string[]) => {
    const l2 = value.l2.filter(v => options.some(o => next.includes(o.l1) && o.l2.some(x => x.name === v)));
    if (sameSet(next, defaultL1) && l2.length === 0) return onChange({ l1: null, l2: [] });
    onChange({ l1: sameSet(next, options.map(o => o.l1)) ? [] : next, l2 });
  };
  const toggleL2 = (name: string, on: boolean) => onChange({ l1: value.l1 === null ? checkedL1 : value.l1, l2: on ? [...value.l2, name] : value.l2.filter(v => v !== name) });
  const count = typeCount(value, options);
  const inline = useContext(InlineContext);

  return (
    <Dropdown label="Product type" count={count} width={880}>
      {/* Two columns: level 1 left, its level 2 values right. */}
      <div className={inline ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 divide-x divide-line'}>
      <div className={inline ? 'min-w-0' : 'min-w-0 pr-2'}>
      <div className="eyebrow px-2 pb-1 pt-0.5">Level 1</div>
      <div className="max-h-72 overflow-y-auto">
        {options.filter(o => o.products > 0).map(o => (
          <Check key={o.l1} checked={checkedL1.includes(o.l1)} muted={o.excludedByDefault}
            onChange={on => setL1(on ? [...checkedL1, o.l1] : checkedL1.filter(v => v !== o.l1))}>
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate">{typeName(o.l1)}{o.excludedByDefault && <span className="ml-1.5 text-[11px]">off by default</span>}</span>
              <span className="num text-xs text-muted">{o.products}</span>
            </span>
          </Check>
        ))}
      </div>
      </div>
      <div className={inline ? 'min-w-0 border-t border-line pt-2' : 'min-w-0 pl-2'}>
      <div className="eyebrow px-2 pb-1 pt-0.5">Level 2 {l2Options.length > 0 && value.l2.length === 0 && <span className="normal-case tracking-normal text-muted">(all)</span>}</div>
      {l2Options.length === 0 && <p className="px-2 py-1.5 text-sm text-muted">No level 2 under the selected types.</p>}
      {l2Options.length > 0 && (
        <>
          <div className="max-h-72 overflow-y-auto">
            {l2Options.map(x => (
              <Check key={`${x.l1}|${x.name}`} checked={value.l2.includes(x.name)} onChange={on => toggleL2(x.name, on)}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{typeName(x.name)}{checkedL1.length > 1 && <span className="ml-1.5 text-[11px] text-muted">{x.l1}</span>}</span>
                  <span className="num text-xs text-muted">{x.products}</span>
                </span>
              </Check>
            ))}
          </div>
        </>
      )}
      </div>
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-line px-2 pt-2 text-xs text-muted">
        <span>{value.l1 === null && value.l2.length === 0 ? 'Default selection' : 'Custom selection'}</span>
        <span className="flex gap-3">
          {value.l1 !== null && value.l1.length === 0 ? null : <button type="button" className="underline" onClick={() => onChange({ l1: [], l2: [] })}>Show all</button>}
          {(value.l1 !== null || value.l2.length > 0) && <button type="button" className="underline" onClick={() => onChange({ l1: null, l2: [] })}>Default</button>}
        </span>
      </div>
    </Dropdown>
  );
}

const typeCount = (value: TypeFilter, options: TypeOption[]) =>
  value.l1 === null && value.l2.length === 0 ? 0 : (value.l1?.length || options.length) + value.l2.length;

// Number of active filters, for the phone's "Filters" button.
function useActiveFilterCount() {
  const { filters } = useScope();
  const options = useFilterOptions();
  return (filters.status ? 1 : 0) + filters.categories.length + filters.campaigns.length + (filters.excludeBrand ? 1 : 0)
    + filters.networks.length + typeCount(filters.types, options.productTypes || []);
}

// Phones: one "Filters" button opens every filter in a sheet.
export function MobileFilters() {
  const options = useFilterOptions();
  const { setFilters } = useScope();
  const count = useActiveFilterCount();
  const [open, setOpen] = useState(false);
  const hasAny = options.campaigns.length > 0 || options.networks.length > 0 || (options.productTypes || []).length > 0;
  if (!hasAny) return null;
  const clear = () => setFilters({ status: '', categories: [], campaigns: [], excludeBrand: false, networks: [], types: { l1: null, l2: [] } });
  return (
    <>
      <button type="button" className="btn-chip topbar-control shrink-0 gap-1.5" data-active={count > 0} onClick={() => setOpen(true)} aria-label={`Filters${count ? `, ${count} active` : ''}`}>
        <Icon name="filter" size={16} />
        <span>Filters</span>
        {count > 0 && <span className="num rounded-full px-1.5 text-[11px]" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>{count}</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Filters"
        footer={<div className="flex items-center justify-between gap-3">
          <button type="button" className="text-sm text-muted underline disabled:no-underline disabled:opacity-40" disabled={count === 0} onClick={clear}>Clear all</button>
          <button type="button" className="btn-chip h-10 px-5" data-active="true" onClick={() => setOpen(false)}>Done</button>
        </div>}>
        <InlineContext.Provider value={true}><FilterBar /></InlineContext.Provider>
      </Sheet>
    </>
  );
}

// Measured widths of the loaded chips (status, Categories, Campaigns, Networks; Producttype),
// so the header wraps the same way before and after the options land.
const PENDING_WIDTHS = { campaigns: [150, 122, 121, 114], types: [120] };

function PendingChips({ widths }: { widths: number[] }) {
  return (
    <div className="skeleton flex flex-wrap items-center gap-1.5" aria-hidden>
      {widths.map((w, i) => <div key={i} className="btn-chip" style={{ width: w }}><SkeletonBar width="60%" height="0.6rem" /></div>)}
    </div>
  );
}

export function FilterBar() {
  const inline = useContext(InlineContext);
  const { filters, setFilters } = useScope();
  const options = useFilterOptions();
  const [query, setQuery] = useState('');
  const types = options.productTypes || [];
  const categories = options.categories || [];
  const hasCampaigns = options.campaigns.length > 0 || options.networks.length > 0;
  if (!inline && options.pending) return <PendingChips widths={PENDING_WIDTHS[options.pending]} />;
  if (!hasCampaigns && types.length === 0) return null;

  const toggle = (list: string[], value: string, on: boolean) => (on ? [...list, value] : list.filter(v => v !== value));
  // Linked filters: each list shows what still occurs under the other filters; a selected value stays (muted) so it can be unchecked.
  const facet = facets(options.campaigns, filters);
  const campaignsAvailable = options.campaigns.filter(c => facet.campaigns.has(c.id) || filters.campaigns.includes(c.id));
  const networksAvailable = options.networks.filter(n => facet.networks.has(n) || filters.networks.includes(n));
  const categoriesAvailable = categories.filter(c => facet.categories.has(c) || filters.categories.includes(c));
  const visible = campaignsAvailable.filter(c => !query || c.name.toLowerCase().includes(query.toLowerCase()));
  const campaignCount = filters.campaigns.length;

  return (
    <div className={inline ? 'flex flex-col' : 'flex flex-wrap items-center gap-1.5'}>
      {inline && hasCampaigns && <label className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm font-medium">Status
        <select value={filters.status} onChange={e => setFilters({ status: e.target.value })} aria-label="Campaign status" className="h-10 min-w-[11rem]">
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>}
      {types.length > 0 && <ProductTypeFilter options={types} value={filters.types} onChange={v => setFilters({ types: v })} />}
      {hasCampaigns && (<>
      {!inline && <select value={filters.status} onChange={e => setFilters({ status: e.target.value })} aria-label="Campaign status" className="btn-chip topbar-control" data-active={!!filters.status}
        style={{ paddingRight: '1.6rem' }}>
        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>}
      {categories.length > 0 && (
        <Dropdown label="Categories" count={filters.categories.length} width={280}>
          <div className="max-h-72 overflow-y-auto">
            {categoriesAvailable.map(c => (
              <Check key={c} checked={filters.categories.includes(c)} muted={!facet.categories.has(c)} onChange={on => setFilters({ categories: toggle(filters.categories, c, on) })}>{c}</Check>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-line px-2 pt-2 text-xs text-muted">
            <span>{filters.categories.length === 0 ? `All ${categoriesAvailable.length} categories` : `${filters.categories.length} of ${categoriesAvailable.length}`}</span>
            {filters.categories.length > 0 && <button type="button" className="underline" onClick={() => setFilters({ categories: [] })}>Clear</button>}
          </div>
        </Dropdown>
      )}
      <Dropdown label="Campaigns" count={campaignCount + (filters.excludeBrand ? 1 : 0)}>
        <label className="mb-1 flex cursor-pointer items-center justify-between gap-2 rounded-md border border-line px-2.5 py-2 text-sm">
          <span className="font-medium">Exclude brand</span>
          <input type="checkbox" className="h-4 w-4" checked={filters.excludeBrand} onChange={e => setFilters({ excludeBrand: e.target.checked })} />
        </label>
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search campaigns" aria-label="Search campaigns" className="mb-1 w-full" />
        <div className="max-h-72 overflow-y-auto">
          {visible.map(c => (
            <Check key={c.id} checked={filters.campaigns.includes(c.id)} muted={!facet.campaigns.has(c.id)}
              onChange={on => setFilters({ campaigns: toggle(filters.campaigns, c.id, on) })}>
              {c.name}
            </Check>
          ))}
          {visible.length === 0 && <p className="px-2 py-1.5 text-sm text-muted">No campaign found.</p>}
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-line px-2 pt-2 text-xs text-muted">
          <span>{campaignCount === 0 ? `All ${campaignsAvailable.length} campaigns` : `${campaignCount} of ${campaignsAvailable.length}`}</span>
          {(campaignCount > 0 || filters.excludeBrand) && <button type="button" className="underline" onClick={() => setFilters({ campaigns: [], excludeBrand: false })}>Clear</button>}
        </div>
      </Dropdown>
      <Dropdown label="Networks" count={filters.networks.length}>
        {networksAvailable.map(n => (
          <Check key={n} checked={filters.networks.includes(n)} muted={!facet.networks.has(n)} onChange={on => setFilters({ networks: toggle(filters.networks, n, on) })}>{n}</Check>
        ))}
        <div className="mt-1 flex items-center justify-between border-t border-line px-2 pt-2 text-xs text-muted">
          <span>{filters.networks.length === 0 ? `All ${networksAvailable.length} networks` : `${filters.networks.length} of ${networksAvailable.length}`}</span>
          {filters.networks.length > 0 && <button type="button" className="underline" onClick={() => setFilters({ networks: [] })}>Clear</button>}
        </div>
      </Dropdown>
      </>)}
    </div>
  );
}
