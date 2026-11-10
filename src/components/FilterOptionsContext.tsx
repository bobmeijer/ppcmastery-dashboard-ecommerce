'use client';

// Pages that read campaign facts publish the campaign and network options for
// the filter dropdowns in the top bar; pages without campaign data leave them
// empty and the dropdowns stay hidden.
import { createContext, useContext, useEffect, useState } from 'react';
import type { CampaignOption } from '@/lib/filters';
import type { TypeOption } from '@/lib/productTypes';

// productTypes: published by the Products and Buckets pages (product type filter).
// pending: the page is still loading and will publish this kind of options; the top bar holds
// their place with placeholder chips so it does not grow a row when they land (skeleton pass, 2026-10-19).
export type PendingFilters = 'campaigns' | 'types';
export interface FilterOptions { campaigns: CampaignOption[]; networks: string[]; categories?: string[]; productTypes?: TypeOption[]; pending?: PendingFilters }

const EMPTY: FilterOptions = { campaigns: [], networks: [] };

const FilterOptionsContext = createContext<{ value: FilterOptions; set: (v: FilterOptions) => void }>({ value: EMPTY, set: () => {} });

export function FilterOptionsProvider({ children }: { children: React.ReactNode }) {
  const [value, set] = useState<FilterOptions>(EMPTY);
  return <FilterOptionsContext.Provider value={{ value, set }}>{children}</FilterOptionsContext.Provider>;
}

export const useFilterOptions = () => useContext(FilterOptionsContext).value;

export function useSetFilterOptions(value: FilterOptions | null, pending: PendingFilters | null = null) {
  const { set } = useContext(FilterOptionsContext);
  useEffect(() => {
    set(value || (pending ? { ...EMPTY, pending } : EMPTY));
    return () => set(EMPTY);
  }, [value, pending, set]);
}
