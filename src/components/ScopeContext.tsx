'use client';

import { ACCOUNTS, DEFAULT_SCOPE, isAccountLabel, moduleEnabled } from '@/lib/config';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { addDays, accountToday, DateRange, isoDate, lagAwareRange } from '@/lib/metrics';
import { compareRangeFor } from '@/lib/compareRange';
import { parseTypeFilter, serializeTypeFilter, TypeFilter } from '@/lib/productTypes';
import { parsePlatform, Platform } from '@/lib/platform';

// Every page is one account label from dashboard.config.ts.
export type Scope = string;
export type CompareMode = 'previous' | 'year' | 'none';
export type Preset = 'l7' | 'l30' | 'l90' | 'mtd' | 'lastmonth' | 'qtd' | 'ytd' | 'custom';

export const SCOPES: { value: Scope; label: string; lagDays: number }[] = ACCOUNTS.map(a => ({ value: a.label, label: a.name, lagDays: a.lagDays }));

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'l7', label: 'Last 7 days' },
  { value: 'l30', label: 'Last 30 days' },
  { value: 'l90', label: 'Last 90 days' },
  { value: 'mtd', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
  { value: 'qtd', label: 'This quarter' },
  { value: 'ytd', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

export const lagDaysFor = (scope: Scope) => SCOPES.find(s => s.value === scope)?.lagDays ?? SCOPES[0].lagDays;

// "Complete" presets end at today minus the lag; calendar presets end yesterday
// and the UI shades the lag window instead.
export function presetRange(preset: Preset, lagDays: number, includeLag: boolean, today = accountToday()): DateRange {
  const yesterday = addDays(isoDate(today), -1);
  const end = includeLag ? yesterday : addDays(isoDate(today), -lagDays);
  // To-date presets anchor on yesterday, the last complete day: on the 1st "This month"
  // is the month that just ended instead of an empty range (start after end).
  const anchor = new Date(`${yesterday}T00:00:00Z`);
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth();
  switch (preset) {
    case 'l7': return { start: addDays(end, -6), end };
    case 'l30': return lagAwareRange(includeLag ? 1 : lagDays, 30, today);
    case 'l90': return lagAwareRange(includeLag ? 1 : lagDays, 90, today);
    case 'mtd': return { start: isoDate(new Date(Date.UTC(y, m, 1))), end: yesterday };
    case 'lastmonth': return { start: isoDate(new Date(Date.UTC(ty, tm - 1, 1))), end: isoDate(new Date(Date.UTC(ty, tm, 0))) };
    case 'qtd': return { start: isoDate(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), end: yesterday };
    case 'ytd': return { start: `${y}-01-01`, end: yesterday };
    default: return lagAwareRange(lagDays, 30, today);
  }
}

export interface Filters {
  campaigns: string[];     // campaign ids; empty = all
  networks: string[];      // display networks; empty = all
  categories: string[];    // campaign categories (name parser); empty = all
  excludeBrand: boolean;   // quick switch inside the campaign filter
  status: string;          // '' = all, else ENABLED | PAUSED | REMOVED (campaign status today)
  types: TypeFilter;       // product type filter (Products, Buckets); URL pt1 / pt2, see lib/productTypes.ts
}

interface ScopeState {
  scope: Scope;
  platform: Platform;   // one platform at a time, Google by default; filtered on the server
  preset: Preset;
  range: DateRange;
  compareRange: DateRange | null;   // calendar-aware, weekday-aligned (lib/compareRange.ts)
  compare: CompareMode;
  includeLag: boolean;
  lagDays: number;
  setScope: (scope: Scope) => void;
  setPlatform: (platform: Platform) => void;
  setContext: (scope: Scope, platform: Platform) => void;   // label + platform in one URL update
  setPreset: (preset: Preset) => void;
  setCustomRange: (range: DateRange) => void;
  setCompare: (compare: CompareMode) => void;
  setIncludeLag: (value: boolean) => void;
  filters: Filters;
  setFilters: (filters: Partial<Filters>) => void;
}

const ScopeContext = createContext<ScopeState | null>(null);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const requestedScope = params.get('scope');
  const scope: Scope = isAccountLabel(requestedScope) ? requestedScope : DEFAULT_SCOPE;
  // Default period: the previous month, which is complete.
  const preset = (PRESETS.some(p => p.value === params.get('preset')) ? params.get('preset') : 'lastmonth') as Preset;
  const compare = (['previous', 'year', 'none'].includes(params.get('compare') || '') ? params.get('compare') : 'previous') as CompareMode;
  // periods end yesterday; the lag window is shaded, never cut off.
  const includeLag = true;
  const lagDays = lagDaysFor(scope);
  const platform: Platform = moduleEnabled('microsoftAds') ? parsePlatform(params.get('platform')) : 'google';
  const list = (key: string) => (params.get(key) || '').split(',').map(v => v.trim()).filter(Boolean);
  const filters = useMemo<Filters>(() => ({ campaigns: list('campaigns'), networks: list('networks'), categories: list('categories'), excludeBrand: params.get('brand') === '0', status: params.get('status') || '', types: parseTypeFilter(params.get('pt1'), params.get('pt2')) }), [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = useMemo<DateRange>(() => {
    const start = params.get('start');
    const end = params.get('end');
    if (preset === 'custom' && start && end && DATE.test(start) && DATE.test(end) && start <= end) return { start, end };
    return presetRange(preset, lagDays, includeLag);
  }, [params, preset, lagDays, includeLag]);

  const compareRange = useMemo(() => compareRangeFor(compare, preset, range), [compare, preset, range]);

  const update = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key); else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`);
  }, [params, pathname, router]);

  const value = useMemo<ScopeState>(() => ({
    scope, platform, preset, range, compareRange, compare, includeLag, lagDays,
    // Product types differ per account, so their filter does not travel along.
    setScope: s => update({ scope: s, pt1: null, pt2: null }),
    // Campaign ids differ per platform, so a campaign selection does not survive a switch.
    setPlatform: p => update({ platform: p === 'microsoft' ? p : null, campaigns: null }),
    setContext: (s, p) => update({ scope: s, platform: p === 'microsoft' ? p : null, campaigns: null, ...(s !== scope ? { pt1: null, pt2: null } : {}) }),
    setPreset: p => update({ preset: p, start: null, end: null }),
    setCustomRange: r => update({ preset: 'custom', start: r.start, end: r.end }),
    setCompare: c => update({ compare: c }),
    setIncludeLag: v => update({ lag: v ? '1' : null }),
    filters,
    setFilters: f => update({
      ...(f.campaigns !== undefined ? { campaigns: f.campaigns.length ? f.campaigns.join(',') : null } : {}),
      ...(f.networks !== undefined ? { networks: f.networks.length ? f.networks.join(',') : null } : {}),
      ...(f.categories !== undefined ? { categories: f.categories.length ? f.categories.join(',') : null } : {}),
      ...(f.excludeBrand !== undefined ? { brand: f.excludeBrand ? '0' : null } : {}),
      ...(f.status !== undefined ? { status: f.status || null } : {}),
      ...(f.types !== undefined ? serializeTypeFilter(f.types) : {}),
    }),
  }), [scope, platform, preset, range, compareRange, compare, includeLag, lagDays, filters, update]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeState {
  const context = useContext(ScopeContext);
  if (!context) throw new Error('useScope must be used inside ScopeProvider');
  return context;
}
