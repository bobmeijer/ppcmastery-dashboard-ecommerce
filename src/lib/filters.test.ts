import { describe, expect, it } from 'vitest';
import { activeFilterCount, applyFilters, displayNetwork, facets, filterOptions, networkGroups, selectedGroup } from './filters';

const row = (over: Partial<{ campaign_id: string; campaign_name: string; network: string; category: string }>) => ({
  campaign_id: 'a', campaign_name: '02 | Stoves', network: 'Search', category: 'Stoves', ...over,
});

const rows = [
  row({ campaign_id: 'a' }),
  row({ campaign_id: 'b', campaign_name: '01 | Brand', category: 'Brand' }),
  row({ campaign_id: 'c', campaign_name: '08 | Lighting [H]', network: 'PMax', category: 'Lighting' }),
  row({ campaign_id: 'c', campaign_name: '08 | Lighting [H]', network: 'PMax', category: 'Lighting' }),
];

const none = { campaigns: [], networks: [], excludeBrand: false, status: '' };

describe('displayNetwork', () => {
  it('splits Search on the Brand category and leaves other networks alone', () => {
    expect(displayNetwork({ network: 'Search', category: 'Brand' })).toBe('Branded Search');
    expect(displayNetwork({ network: 'Search', category: 'Stoves' })).toBe('Non-Branded Search');
    expect(displayNetwork({ network: 'PMax', category: 'Lighting' })).toBe('Non-Branded Shopping');
    expect(displayNetwork({ network: 'Shopping', category: 'Brand' })).toBe('Branded Shopping');
    expect(displayNetwork({ network: 'Shopping', category: 'Stoves' })).toBe('Non-Branded Shopping');
    expect(displayNetwork({ network: 'Display', category: 'Remarketing' })).toBe('Display');
  });
});

describe('applyFilters', () => {
  it('returns everything when nothing is set', () => {
    expect(applyFilters(rows, none)).toHaveLength(4);
  });

  it('keeps only the chosen campaign categories', () => {
    expect(applyFilters(rows, { ...none, categories: ['Lighting'] }).map(r => r.campaign_id)).toEqual(['c', 'c']);
    expect(applyFilters(rows, { ...none, categories: [] })).toHaveLength(4);
  });
  it('drops brand campaigns with excludeBrand', () => {
    expect(applyFilters(rows, { ...none, excludeBrand: true }).map(r => r.campaign_id)).toEqual(['a', 'c', 'c']);
  });
  it('filters on campaign status when set', () => {
    const withStatus = rows.map((r, i) => ({ ...r, status: i === 0 ? 'PAUSED' : 'ENABLED' }));
    expect(applyFilters(withStatus, { ...none, status: 'PAUSED' })).toHaveLength(1);
    expect(applyFilters(withStatus, { ...none, status: '' })).toHaveLength(4);
    expect(applyFilters(rows.map(r => ({ ...r, status: '' })), { ...none, status: 'REMOVED' })).toHaveLength(4);
  });
  it('filters on campaign ids and display networks together', () => {
    expect(applyFilters(rows, { ...none, campaigns: ['b', 'c'] })).toHaveLength(3);
    expect(applyFilters(rows, { ...none, networks: ['Branded Search'] }).map(r => r.campaign_id)).toEqual(['b']);
    expect(applyFilters(rows, { ...none, campaigns: ['b'], networks: ['Non-Branded Shopping'] })).toHaveLength(0);
  });
});

describe('filterOptions', () => {
  it('dedupes campaigns, flags brand and orders networks', () => {
    const options = filterOptions(rows);
    expect(options.campaigns.map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(options.campaigns.find(c => c.id === 'b')?.brand).toBe(true);
    expect(options.networks).toEqual(['Branded Search', 'Non-Branded Search', 'Non-Branded Shopping']);
  });
});

describe('activeFilterCount', () => {
  it('counts each filter group once', () => {
    expect(activeFilterCount(none)).toBe(0);
    expect(activeFilterCount({ campaigns: ['a', 'b'], networks: [], excludeBrand: true })).toBe(2);
  });
});

describe('filterOptions categories', () => {
  it('lists each product category once, without Brand, Remarketing, Competitors or Other', () => {
    const more = [...rows, row({ campaign_id: 'd', category: 'Remarketing', network: 'Display' }), row({ campaign_id: 'e', category: 'Other' })];
    expect(filterOptions(more).categories).toEqual(['Lighting', 'Stoves']);
  });
});

describe('linked filters', () => {
  const options = filterOptions(rows).campaigns;

  it('narrows campaigns and networks to the chosen category', () => {
    const f = facets(options, { ...none, categories: ['Lighting'] });
    expect([...f.campaigns]).toEqual(['c']);
    expect([...f.networks]).toEqual(['Non-Branded Shopping']);
    expect(f.categories.size).toBe(2);   // its own list stays complete (product categories only)
  });

  it('narrows categories to the chosen network, and to the chosen campaigns', () => {
    expect([...facets(options, { ...none, networks: ['Non-Branded Shopping'] }).categories]).toEqual(['Lighting']);
    expect([...facets(options, { ...none, campaigns: ['a', 'c'] }).categories].sort()).toEqual(['Lighting', 'Stoves']);
  });

  it('takes Exclude brand and status into account', () => {
    expect(facets(options, { ...none, excludeBrand: true }).campaigns.has('b')).toBe(false);
    expect(facets(options, { ...none, status: 'PAUSED' }).campaigns.size).toBe(0);   // test rows have no status: REMOVED
  });
});

describe('network groups', () => {
  const groups = networkGroups(['Branded Search', 'Non-Branded Search', 'Non-Branded Shopping', 'Branded Shopping', 'Display', 'Demand Gen']);

  it('groups the branded and non-branded halves, Search, Shopping, Display first', () => {
    expect(groups.map(g => g.label)).toEqual(['Search', 'Shopping', 'Display', 'Demand Gen']);
    expect(groups[0].networks).toEqual(['Branded Search', 'Non-Branded Search']);
  });

  it('recognises a selection that equals a group', () => {
    expect(selectedGroup([], groups)).toBe('');
    expect(selectedGroup(['Non-Branded Search', 'Branded Search'], groups)).toBe('Search');
    expect(selectedGroup(['Non-Branded Search'], groups)).toBeNull();
  });
});
