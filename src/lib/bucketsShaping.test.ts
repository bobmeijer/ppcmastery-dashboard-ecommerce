import { describe, expect, it } from 'vitest';
import type { FactRow } from './metrics';
import { bucketGroup, bucketMatrix, productLabel, ProductFactRow } from './bucketsShaping';

describe('productLabel', () => {
  it('maps ProductHero words and letters onto one letter, keeps unknown values visible', () => {
    expect(productLabel('heroes')).toBe('H');
    expect(productLabel('Sidekicks')).toBe('S');
    expect(productLabel('villain')).toBe('V');
    expect(productLabel(' zombies ')).toBe('Z');
    expect(productLabel('z')).toBe('Z');
    expect(productLabel('new')).toBe('NEW');
    expect(productLabel(null)).toBe('');
  });
});

const fact = (over: Partial<FactRow>): FactRow => ({
  account_id: '1000000001', period: '2026-09-01', campaign_id: 'c', campaign_name: 'n', channel_type: 'PERFORMANCE_MAX', status: 'ENABLED',
  network: 'PMax', category: 'Garden Chairs', bucket: 'H+S', target_roas: null, target_cpa: null,
  impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, all_conversions: 0, all_conversions_value: 0,
  eligible_impressions: 0, is_impressions: 0, budget_lost_impressions: 0, rank_lost_impressions: 0,
  ...over,
});

const product = (over: Partial<ProductFactRow>): ProductFactRow => ({
  account_id: '1000000001', campaign_id: 'c', campaign_name: 'n', network: 'PMax', category: 'Garden Chairs', campaign_bucket: 'H+S',
  product_item_id: 'p1', product_title: 'Bench 1', product_type: 'Benches', brand: null,
  custom_label_0: null, custom_label_1: null, custom_label_2: 'H', custom_label_3: null, custom_label_4: null, country_code: 'NL',
  impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0, source: 'daily',
  ...over,
});

describe('bucketGroup', () => {
  it('maps known buckets and full-word aliases, folds unknown ones into Other, leaves empty and bidding notes out', () => {
    expect(bucketGroup('H+S')).toBe('H+S');
    expect(bucketGroup('v+z')).toBe('V+Z');
    expect(bucketGroup('H+S+V')).toBe('H+S+V');
    expect(bucketGroup('V')).toBe('V');
    expect(bucketGroup('Villains')).toBe('V');
    expect(bucketGroup('Zombies')).toBe('Z');
    expect(bucketGroup('All')).toBe('All');
    expect(bucketGroup('Boost')).toBe('Boost');
    expect(bucketGroup('S+V')).toBe('Other');
    expect(bucketGroup('tCPA')).toBeNull();
    expect(bucketGroup('')).toBeNull();
    expect(bucketGroup(null)).toBeNull();
  });
});

describe('bucketMatrix', () => {
  it('builds category rows with bucket cells, row and column totals, sorted by cost', () => {
    const matrix = bucketMatrix([
      fact({ category: 'Garden Chairs', bucket: 'H+S', cost: 100, conversions_value: 500 }),
      fact({ category: 'Garden Chairs', bucket: 'V+Z', cost: 50, conversions_value: 100 }),
      fact({ category: 'Stoves', bucket: 'H+S', cost: 300, conversions_value: 900 }),
      fact({ category: 'Brand', bucket: '', network: 'Search', cost: 999 }),
    ]);
    expect(matrix.columns).toEqual(['H+S', 'V+Z']);
    expect(matrix.rows.map(r => r.category)).toEqual(['Stoves', 'Garden Chairs']);
    expect(matrix.rows[1].cells['H+S']?.roas).toBe(5);
    expect(matrix.rows[1].cells['V+Z']?.cost).toBe(50);
    expect(matrix.rows[0].cells['V+Z']).toBeUndefined();
    expect(matrix.rows[1].total.cost).toBe(150);
    expect(matrix.columnTotals['H+S']?.cost).toBe(400);
    expect(matrix.total.cost).toBe(450);
  });

  it('orders the columns with Z right after V+Z', () => {
    const matrix = bucketMatrix([
      fact({ category: 'A', bucket: 'Z', cost: 1 }), fact({ category: 'A', bucket: 'All', cost: 1 }),
      fact({ category: 'A', bucket: 'V+Z', cost: 1 }), fact({ category: 'A', bucket: 'H+S', cost: 1 }),
    ]);
    expect(matrix.columns).toEqual(['H+S', 'V+Z', 'Z', 'All']);
  });

  it('is empty without bucketed campaigns', () => {
    const matrix = bucketMatrix([fact({ bucket: '', cost: 10 })]);
    expect(matrix.columns).toEqual([]);
    expect(matrix.rows).toEqual([]);
  });
});

