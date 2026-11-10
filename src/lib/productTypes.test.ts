import { describe, expect, it } from 'vitest';
import { effectiveTypeFilter, matchesType, parseTypeFilter, serializeTypeFilter, typeLevels, typeOptions } from './productTypes';

const products = [
  { id: '1', product_type: 'Garden Chairs > Dining chairs' },
  { id: '2', product_type: 'garden chairs > lounge chairs' },
  { id: '3', product_type: 'benches > teak benches' },
  { id: '4', product_type: 'outlet' },
  { id: '5', product_type: null },
];
const options = typeOptions(products, ['outlet', 'unknown']);

describe('typeLevels', () => {
  it('splits and lowercases the path, empty = unknown', () => {
    expect(typeLevels('Garden Chairs > Dining chairs > x')).toEqual({ l1: 'garden chairs', l2: 'dining chairs' });
    expect(typeLevels('')).toEqual({ l1: 'unknown', l2: '' });
  });
});

describe('parse and serialize', () => {
  it('round-trips default, all and lists', () => {
    for (const [pt1, pt2] of [[null, null], ['*', null], ['benches', 'teak benches']] as const) {
      const f = parseTypeFilter(pt1, pt2);
      expect(serializeTypeFilter(f)).toEqual({ pt1, pt2 });
    }
    expect(parseTypeFilter(null, null)).toEqual({ l1: null, l2: [] });
    expect(parseTypeFilter('*', null)).toEqual({ l1: [], l2: [] });
  });
});

describe('typeOptions', () => {
  it('counts products per level and puts default exclusions last', () => {
    expect(options.map(o => [o.l1, o.products, o.excludedByDefault])).toEqual([
      ['garden chairs', 2, false], ['benches', 1, false], ['outlet', 1, true], ['unknown', 1, true],
    ]);
    expect(options[0].l2.map(x => x.name)).toEqual(['dining chairs', 'lounge chairs']);
  });
});

describe('effectiveTypeFilter', () => {
  it('applies the account default when the URL says nothing', () => {
    const e = effectiveTypeFilter(parseTypeFilter(null, null), options, ['outlet', 'unknown']);
    expect(e.isDefault).toBe(true);
    expect(e.excluded).toEqual(['outlet', 'unknown']);
    expect(matchesType(typeLevels('outlet'), e)).toBe(false);
    expect(matchesType(typeLevels('benches > teak benches'), e)).toBe(true);
  });

  it('shows everything with *', () => {
    const e = effectiveTypeFilter(parseTypeFilter('*', null), options, ['outlet']);
    expect(e.l1).toBeNull();
    expect(matchesType(typeLevels('outlet'), e)).toBe(true);
  });

  it('keeps level 2 only inside the chosen level 1', () => {
    const e = effectiveTypeFilter(parseTypeFilter('garden chairs', 'dining chairs,teak benches'), options, []);
    expect([...e.l2!]).toEqual(['dining chairs']);
    expect(matchesType(typeLevels('garden chairs > dining chairs'), e)).toBe(true);
    expect(matchesType(typeLevels('garden chairs > lounge chairs'), e)).toBe(false);
  });
});
