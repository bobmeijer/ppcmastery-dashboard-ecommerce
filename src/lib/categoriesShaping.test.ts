import { describe, expect, it } from 'vitest';
import { emptyTotals, FactRow } from './metrics';
import {
  aggregateProductRows, campaignRowsFor, categoryRowsFromCampaigns, categoryRowsFromProducts, categoryTrend, compareBuckets,
  OTHER, productBuckets, splitProductType, subtypeRowsFor, uniformTargetRoas,
} from './categoriesShaping';

const fact = (over: Partial<FactRow>): FactRow => ({
  account_id: '1', period: '2026-10-01', campaign_id: 'c1', campaign_name: '02 | Stoves', channel_type: 'SEARCH', status: 'ENABLED',
  network: 'Search', category: 'Stoves', bucket: '', target_roas: null, target_cpa: null,
  ...emptyTotals(), ...over,
});

describe('splitProductType', () => {
  it('takes the first level as category and capitalises it', () => {
    expect(splitProductType('solar lighting > custom size > 120 cm')).toEqual({ l1: 'Solar lighting', l2: 'Custom size' });
    expect(splitProductType('parasols')).toEqual({ l1: 'Parasols', l2: '' });
    expect(splitProductType('')).toEqual({ l1: OTHER, l2: '' });
  });
});

describe('aggregateProductRows', () => {
  it('collapses item rows to level 1 x level 2', () => {
    const rows = aggregateProductRows('2026-10-01', [
      { product_type: 'a > x', cost: 1, conversions_value: 10 },
      { product_type: 'a > x', cost: 2, conversions_value: 20 },
      { product_type: 'a > y', cost: 3, conversions_value: 0 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.product_type_l2 === 'X')).toMatchObject({ period: '2026-10-01', product_type_l1: 'A', cost: 3, conversions_value: 30 });
  });
});

describe('productBuckets', () => {
  it('uses one bucket per day inside the daily window', () => {
    const plan = productBuckets({ start: '2026-10-01', end: '2026-10-03' }, '2026-09-08');
    expect(plan.coverage).toBe('daily');
    expect(plan.buckets.map(b => b.period)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
  it('falls back to calendar months when the range starts before the daily floor', () => {
    const plan = productBuckets({ start: '2026-07-15', end: '2026-10-12' }, '2026-09-08');
    expect(plan.coverage).toBe('monthly');
    expect(plan.buckets).toEqual([
      { period: '2026-07-01', start: '2026-07-01', end: '2026-07-31' },
      { period: '2026-08-01', start: '2026-08-01', end: '2026-08-31' },
      { period: '2026-09-01', start: '2026-09-01', end: '2026-09-30' },
      { period: '2026-10-01', start: '2026-10-01', end: '2026-10-12' },
    ]);
  });
  it('has no honest compare when the current period is daily but the compare period predates the floor', () => {
    expect(compareBuckets({ start: '2026-08-14', end: '2026-09-12' }, '2026-09-08', 'daily')).toBeNull();
    expect(compareBuckets({ start: '2026-09-20', end: '2026-09-25' }, '2026-09-08', 'daily')).toHaveLength(1);
    expect(compareBuckets({ start: '2026-04-15', end: '2026-07-14' }, '2026-09-08', 'monthly')?.map(b => b.period)).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']);
  });
});

describe('uniformTargetRoas', () => {
  it('returns the shared target and ignores campaigns without spend', () => {
    expect(uniformTargetRoas([
      fact({ campaign_id: 'a', cost: 10, target_roas: 8 }),
      fact({ campaign_id: 'b', cost: 10, target_roas: 8 }),
      fact({ campaign_id: 'c', cost: 0, target_roas: 3 }),
    ])).toBe(8);
  });
  it('returns null when campaigns disagree or one has no target', () => {
    expect(uniformTargetRoas([fact({ campaign_id: 'a', cost: 10, target_roas: 8 }), fact({ campaign_id: 'b', cost: 10, target_roas: 10 })])).toBeNull();
    expect(uniformTargetRoas([fact({ campaign_id: 'a', cost: 10, target_roas: 8 }), fact({ campaign_id: 'b', cost: 10, target_roas: null })])).toBeNull();
    expect(uniformTargetRoas([])).toBeNull();
  });
});

describe('category rows', () => {
  const rows = [
    fact({ campaign_id: 'a', category: 'Stoves', cost: 100, conversions_value: 800, conversions: 4, target_roas: 8 }),
    fact({ campaign_id: 'b', category: 'Stoves', cost: 100, conversions_value: 400, conversions: 2, target_roas: 8, network: 'PMax', bucket: 'Z' }),
    fact({ campaign_id: 'c', category: 'Brand', cost: 50, conversions_value: 500, conversions: 5 }),
  ];
  const compare = [fact({ campaign_id: 'a', category: 'Stoves', cost: 100, conversions_value: 400 })];

  it('aggregates per category with share, delta base and uniform target', () => {
    const result = categoryRowsFromCampaigns(rows, compare);
    expect(result.map(r => r.name)).toEqual(['Stoves', 'Brand']);
    const stoves = result[0];
    expect(stoves.cost).toBe(200);
    expect(stoves.roas).toBe(6);
    expect(stoves.share).toBeCloseTo(0.7058823529411765);   // revenue share
    expect(stoves.items).toBe(2);
    expect(stoves.target_roas).toBe(8);
    expect(stoves.previous?.conversions_value).toBe(400);
    expect(result[1].previous).toBeNull();
    expect(result[1].target_roas).toBeNull();
  });

  it('drills down to the campaigns of one category', () => {
    const result = campaignRowsFor(rows, compare, 'Stoves');
    expect(result).toHaveLength(2);
    expect(result.find(r => r.campaign_id === 'b')).toMatchObject({ network: 'PMax', bucket: 'Z', roas: 4, previous: null, target_roas: 8 });
    expect(result.find(r => r.campaign_id === 'b')!.share).toBeCloseTo(1 / 3, 6);
    expect(result.find(r => r.campaign_id === 'a')?.previous?.roas).toBe(4);
  });

  it('builds the same shape from product types', () => {
    const facts = aggregateProductRows('2026-10-01', [
      { product_type: 'lighting > custom size', cost: 10, conversions_value: 100 },
      { product_type: 'lighting > standard', cost: 30, conversions_value: 100 },
      { product_type: 'dividers', cost: 10, conversions_value: 10 },
    ]);
    const result = categoryRowsFromProducts(facts, null, 5);
    expect(result.map(r => r.name)).toEqual(['Lighting', 'Dividers']);
    expect(result[0]).toMatchObject({ cost: 40, roas: 5, items: 2, target_roas: 5, previous: null });
    expect(result[0].share).toBeCloseTo(0.9523809523809523, 6);
    const subtypes = subtypeRowsFor(facts, null, 'Lighting');
    expect(subtypes.map(s => s.name)).toEqual(['Standard', 'Custom size']);
  });
});

describe('categoryTrend', () => {
  it('keeps the top N by cost and folds the rest into Other', () => {
    const input = [];
    for (let i = 0; i < 10; i++) {
      input.push({ period: '2026-10-01', name: `cat${i}`, cost: 100 - i, conversions_value: 10 });
      input.push({ period: '2026-10-02', name: `cat${i}`, cost: 100 - i, conversions_value: 20 });
    }
    const trend = categoryTrend(input, 8);
    expect(trend.names).toHaveLength(9);
    expect(trend.names[8]).toBe(OTHER);
    expect(trend.points.map(p => p.period)).toEqual(['2026-10-01', '2026-10-02']);
    expect(trend.points[0].values[OTHER].cost).toBe(92 + 91);
    expect(trend.points[1].values.cat0.conversions_value).toBe(20);
  });
  it('fills missing periods with zeros and merges an existing Other', () => {
    const trend = categoryTrend([
      { period: '2026-10-01', name: 'A', cost: 5 },
      { period: '2026-10-02', name: OTHER, cost: 1 },
    ]);
    expect(trend.names).toEqual(['A', OTHER]);
    expect(trend.points[1].values.A.cost).toBe(0);
    expect(trend.points[1].values.A.roas).toBeNull();
    expect(trend.points[1].values[OTHER].cost).toBe(1);
  });
});
