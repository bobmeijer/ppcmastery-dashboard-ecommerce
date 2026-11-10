import { LOCALE } from '@/lib/config';
// Product type filter for the Products and Buckets pages.
// Level 1 and level 2 of the Google product type path, lowercased. The filter
// lives in the URL: pt1 absent = the account's default (everything except the
// types in product_type_exclusions), pt1=* = everything, pt1=a,b = only those;
// pt2 narrows inside the chosen level 1 types. Pure, tested in productTypes.test.ts.

export const UNKNOWN_TYPE = 'unknown';
export const ALL_TYPES = '*';

export interface TypeLevels { l1: string; l2: string }

// "Garden Chairs > Dining chairs > x" -> { l1: 'garden chairs', l2: 'dining chairs' }
export function typeLevels(productType: string | null | undefined): TypeLevels {
  const parts = (productType || '').split('>').map(p => p.trim().toLowerCase());
  return { l1: parts[0] || UNKNOWN_TYPE, l2: parts[1] || '' };
}

export interface TypeFilter {
  l1: string[] | null;   // null = account default
  l2: string[];          // empty = all level 2 inside the chosen level 1
}

export const parseTypeFilter = (pt1: string | null, pt2: string | null): TypeFilter => ({
  l1: pt1 === null || pt1 === '' ? null : pt1 === ALL_TYPES ? [] : pt1.split(',').map(v => v.trim()).filter(Boolean),
  l2: (pt2 || '').split(',').map(v => v.trim()).filter(Boolean),
});

// Inverse of parseTypeFilter for the URL: null = default (no param).
export const serializeTypeFilter = (filter: TypeFilter): { pt1: string | null; pt2: string | null } => ({
  pt1: filter.l1 === null ? null : filter.l1.length === 0 ? ALL_TYPES : filter.l1.join(','),
  pt2: filter.l2.length ? filter.l2.join(',') : null,
});

export interface TypeOption {
  l1: string;
  products: number;
  excludedByDefault: boolean;
  l2: { name: string; products: number }[];
}

export interface EffectiveTypeFilter {
  l1: Set<string> | null;  // null = no level 1 restriction
  l2: Set<string> | null;
  isDefault: boolean;
  excluded: string[];      // level 1 types left out (for the notice)
}

// The concrete sets to filter on, given the URL filter and the account default.
export function effectiveTypeFilter(filter: TypeFilter, options: TypeOption[], excludedByDefault: string[]): EffectiveTypeFilter {
  const all = options.map(o => o.l1);
  let l1: Set<string> | null;
  if (filter.l1 === null) {
    const excluded = new Set(excludedByDefault);
    l1 = excluded.size ? new Set(all.filter(t => !excluded.has(t))) : null;
  } else {
    l1 = filter.l1.length ? new Set(filter.l1) : null;
  }
  // Level 2 only counts for values that belong to a chosen level 1.
  const allowedL2 = new Set(options.filter(o => !l1 || l1.has(o.l1)).flatMap(o => o.l2.map(x => x.name)));
  const l2Values = filter.l2.filter(v => allowedL2.has(v));
  return {
    l1,
    l2: l2Values.length ? new Set(l2Values) : null,
    isDefault: filter.l1 === null && filter.l2.length === 0,
    excluded: l1 ? all.filter(t => !l1!.has(t)) : [],
  };
}

export const matchesType = (levels: TypeLevels, effective: EffectiveTypeFilter) =>
  (!effective.l1 || effective.l1.has(levels.l1)) && (!effective.l2 || effective.l2.has(levels.l2));

// Options from every product the page knows (period facts plus the feed), most products first.
export function typeOptions(productTypes: { id: string; product_type: string | null }[], excludedByDefault: string[]): TypeOption[] {
  const excluded = new Set(excludedByDefault);
  const byL1 = new Map<string, { ids: Set<string>; l2: Map<string, Set<string>> }>();
  for (const p of productTypes) {
    const { l1, l2 } = typeLevels(p.product_type);
    const group = byL1.get(l1) || { ids: new Set<string>(), l2: new Map<string, Set<string>>() };
    group.ids.add(p.id);
    if (l2) group.l2.set(l2, (group.l2.get(l2) || new Set<string>()).add(p.id));
    byL1.set(l1, group);
  }
  for (const t of excluded) if (!byL1.has(t)) byL1.set(t, { ids: new Set(), l2: new Map() });
  return [...byL1.entries()]
    .map(([l1, g]) => ({
      l1,
      products: g.ids.size,
      excludedByDefault: excluded.has(l1),
      l2: [...g.l2.entries()].map(([name, ids]) => ({ name, products: ids.size })).sort((a, b) => b.products - a.products || a.name.localeCompare(b.name, LOCALE)),
    }))
    .sort((a, b) => Number(a.excludedByDefault) - Number(b.excludedByDefault) || b.products - a.products || a.l1.localeCompare(b.l1, LOCALE));
}

// Display form: first letter capitalised ("garden chairs" -> "Garden chairs").
export const typeName = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '-');
