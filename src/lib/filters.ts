import { LOCALE } from '@/lib/config';
// Campaign, network, category and brand filters applied client-side to campaign facts.
// Pure, tested in filters.test.ts. The display network splits Search into
// branded and non-branded.

export interface FilterState {
  campaigns: string[];
  networks: string[];
  categories?: string[];   // campaign categories from the name parser; empty or absent = all
  excludeBrand: boolean;
  status?: string;      // '' or undefined = all
}

export interface FilterableRow {
  campaign_id: string;
  campaign_name: string;
  network: string;
  category: string;
  status?: string;
}

// Search and Shopping each split on Brand, and PMax is
// counted as Shopping (feed-only campaigns): Branded Search (01 | Brand),
// Non-Branded Search, Branded Shopping (05 | Brand), Non-Branded Shopping
// (other Shopping campaigns plus every PMax campaign).
export const displayNetwork = (r: { network: string; category: string }) => {
  const brand = r.category === 'Brand';
  if (r.network === 'Search') return brand ? 'Branded Search' : 'Non-Branded Search';
  if (r.network === 'Shopping' || r.network === 'PMax') return brand ? 'Branded Shopping' : 'Non-Branded Shopping';
  return r.network;
};

export const isBrand = (r: { category: string }) => r.category === 'Brand';

export function applyFilters<T extends FilterableRow>(rows: T[], filters: FilterState): T[] {
  const campaigns = filters.campaigns.length ? new Set(filters.campaigns) : null;
  const networks = filters.networks.length ? new Set(filters.networks) : null;
  const categories = filters.categories?.length ? new Set(filters.categories) : null;
  return rows.filter(r => {
    if (filters.excludeBrand && isBrand(r)) return false;
    // Rows without a dimension row (campaign removed before the dim sync kept removed ones) count as REMOVED.
    if (filters.status && (r.status || 'REMOVED') !== filters.status) return false;
    if (campaigns && !campaigns.has(r.campaign_id)) return false;
    if (networks && !networks.has(displayNetwork(r))) return false;
    if (categories && !categories.has(r.category)) return false;
    return true;
  });
}

export interface CampaignOption { id: string; name: string; network: string; category: string; status: string; brand: boolean }

export const NETWORK_ORDER = ['Branded Search', 'Branded Shopping', 'Non-Branded Search', 'Non-Branded Shopping', 'Display', 'Demand Gen', 'Video', 'Other'];

// Options for the dropdowns, from the unfiltered rows of the current period.
// The category filter offers product categories only: Brand,
// Remarketing, Competitors and Other (unparsed names) are campaign roles, not
// products, and stay out of the list. Picking a product category leaves them out of the data too.
export const NON_PRODUCT_CATEGORIES = ['Brand', 'Remarketing', 'Competitors', 'Other'];
export const isProductCategory = (c: string) => !!c && !NON_PRODUCT_CATEGORIES.includes(c);

export function filterOptions(rows: FilterableRow[]): { campaigns: CampaignOption[]; networks: string[]; categories: string[] } {
  const byId = new Map<string, CampaignOption>();
  const networks = new Set<string>();
  const categories = new Set<string>();
  for (const r of rows) {
    const network = displayNetwork(r);
    networks.add(network);
    if (isProductCategory(r.category)) categories.add(r.category);
    if (!byId.has(r.campaign_id)) byId.set(r.campaign_id, { id: r.campaign_id, name: r.campaign_name, network, category: r.category, status: r.status || 'REMOVED', brand: isBrand(r) });
  }
  return {
    campaigns: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, LOCALE)),
    networks: [...networks].sort((a, b) => (NETWORK_ORDER.indexOf(a) + 100) % 100 - (NETWORK_ORDER.indexOf(b) + 100) % 100 || a.localeCompare(b)),
    categories: [...categories].sort((a, b) => a.localeCompare(b, LOCALE)),
  };
}

// Linked filters: status, category, campaign and network narrow
// each other. Each dropdown offers the values that still occur among the
// campaigns passing every OTHER filter (faceted search), so picking a category
// leaves only its campaigns and networks, and the other way round.
export interface Facets { campaigns: Set<string>; networks: Set<string>; categories: Set<string> }

export function facets(campaigns: CampaignOption[], f: FilterState): Facets {
  const passes = (c: CampaignOption, skip: keyof Facets) =>
    !(f.excludeBrand && c.brand)
    && (!f.status || c.status === f.status)
    && (skip === 'campaigns' || !f.campaigns.length || f.campaigns.includes(c.id))
    && (skip === 'networks' || !f.networks.length || f.networks.includes(c.network))
    && (skip === 'categories' || !f.categories?.length || f.categories.includes(c.category));
  const out: Facets = { campaigns: new Set(), networks: new Set(), categories: new Set() };
  for (const c of campaigns) {
    if (passes(c, 'campaigns')) out.campaigns.add(c.id);
    if (passes(c, 'networks')) out.networks.add(c.network);
    if (passes(c, 'categories') && isProductCategory(c.category)) out.categories.add(c.category);
  }
  return out;
}

// Network groups for the quick filter: Search and Shopping each take their
// branded and non-branded half (PMax counts as Shopping); other networks
// (Display, Demand Gen, Video, Other) are a group of their own.
const GROUPS: Record<string, string> = {
  'Branded Search': 'Search', 'Non-Branded Search': 'Search', 'Branded Shopping': 'Shopping', 'Non-Branded Shopping': 'Shopping',
};
export const networkGroup = (network: string) => GROUPS[network] || network;

export function networkGroups(networks: string[]): { label: string; networks: string[] }[] {
  const byLabel = new Map<string, string[]>();
  for (const n of networks) byLabel.set(networkGroup(n), [...(byLabel.get(networkGroup(n)) || []), n]);
  const order = ['Search', 'Shopping', 'Display'];
  const rank = (l: string) => (order.includes(l) ? order.indexOf(l) : order.length);
  return [...byLabel.entries()].map(([label, list]) => ({ label, networks: list })).sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

// The group a selection equals exactly, '' for no selection, null for anything else.
export function selectedGroup(selected: string[], groups: { label: string; networks: string[] }[]): string | null {
  if (selected.length === 0) return '';
  const match = groups.find(g => g.networks.length === selected.length && g.networks.every(n => selected.includes(n)));
  return match ? match.label : null;
}

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'ENABLED', label: 'Enabled' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'REMOVED', label: 'Removed' },
];

// Goals are account-wide (all campaigns incl. Brand): any filter that narrows the
// campaigns makes "% of goal" meaningless, so goals hide.
export const narrowsCampaigns = (f: FilterState) =>
  f.excludeBrand || f.campaigns.length > 0 || f.networks.length > 0 || (f.categories?.length ?? 0) > 0 || !!f.status;

export const activeFilterCount = (filters: FilterState) =>
  (filters.campaigns.length ? 1 : 0) + (filters.networks.length ? 1 : 0) + (filters.categories?.length ? 1 : 0) + (filters.excludeBrand ? 1 : 0) + (filters.status ? 1 : 0);
