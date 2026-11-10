import { describe, expect, it } from 'vitest';
import { buildMetricTree, FUNNEL_BANDS, FUNNEL_ROWS, largestParts, revenueBridge, roasBridge, TREE_NODES } from './metricTree';
import { sumRows } from './metrics';

// Search with impression share data, PMax without.
const search = { impressions: 1000, clicks: 100, cost: 200, conversions: 4, conversions_value: 800, eligible_impressions: 2000, is_impressions: 1000, budget_lost_impressions: 200, rank_lost_impressions: 800 };
const pmax = { impressions: 3000, clicks: 60, cost: 100, conversions: 2, conversions_value: 600 };

describe('buildMetricTree', () => {
  const tree = buildMetricTree([search, pmax], [{ ...search, clicks: 80, cost: 160, conversions: 4 }, pmax]);
  const node = (key: string) => tree.nodes.find(n => n.key === key)!;

  it('derives every node from the summed rows', () => {
    expect(node('impressions').value).toBe(4000);
    expect(node('clicks').value).toBe(160);
    expect(node('ctr').value).toBe(0.04);
    expect(node('cpc').value).toBe(300 / 160);
    expect(node('cvr').value).toBe(6 / 160);
    expect(node('aov').value).toBe(1400 / 6);
    expect(node('roas').value).toBe(1400 / 300);
    expect(node('cpa').value).toBe(50);
  });

  it('takes impression share and lost IS from the campaigns that report them, with the coverage', () => {
    expect(node('eligible_impressions').value).toBe(2000);
    expect(node('impression_share').value).toBe(0.5);
    expect(node('budget_lost_is').value).toBe(0.1);
    expect(node('rank_lost_is').value).toBe(0.4);
    expect(tree.isCoverage).toBe(0.25);
  });

  it('compares with the previous period and colours by direction, cost neutral', () => {
    expect(tree.hasCompare).toBe(true);
    expect(node('clicks')).toMatchObject({ previous: 140, tone: 'good' });
    expect(node('clicks').change).toBeCloseTo(20 / 140);
    expect(node('cost').tone).toBeNull();
    expect(node('cpa').tone).toBe('bad');   // 300 / 6 = 50 vs 260 / 6 = 43.3: more expensive
    expect(node('impressions').tone).toBeNull(); // unchanged
  });

  it('works without a comparison and without impression share data', () => {
    const plain = buildMetricTree([pmax], null);
    expect(plain.hasCompare).toBe(false);
    expect(plain.nodes.every(n => n.change === null && n.tone === null)).toBe(true);
    expect(plain.nodes.find(n => n.key === 'impression_share')!.value).toBeNull();
    expect(plain.isCoverage).toBe(0);
  });

  it('places every node exactly once in the funnel, and the bands cover every row', () => {
    const placed = FUNNEL_ROWS.flatMap(r => (r.kind === 'stage' ? [r.key, ...r.left, ...r.right] : [r.key]));
    expect([...placed].sort()).toEqual(TREE_NODES.map(n => n.key).sort());
    const rows = FUNNEL_BANDS.flatMap(b => Array.from({ length: b.to - b.from + 1 }, (_, i) => b.from + i));
    expect(rows).toEqual(FUNNEL_ROWS.map((_, i) => i + 1));
  });
});

describe('contributions', () => {
  const cur = sumRows([{ impressions: 1000, clicks: 50, cost: 100, conversions: 2, conversions_value: 300 }]);
  const prev = sumRows([{ impressions: 800, clicks: 48, cost: 72, conversions: 3, conversions_value: 360 }]);
  const sum = (parts: { amount: number }[]) => parts.reduce((a, p) => a + p.amount, 0);

  it('splits the revenue change over impressions, CTR, conv. rate and AOV without remainder', () => {
    const b = revenueBridge(cur, prev)!;
    expect(b.parts.map(p => p.key)).toEqual(['impressions', 'ctr', 'cvr', 'aov']);
    expect(sum(b.parts)).toBeCloseTo(300 - 360, 9);
    expect(b.parts.find(p => p.key === 'impressions')!.amount).toBeGreaterThan(0);
    expect(b.parts.find(p => p.key === 'cvr')!.amount).toBeLessThan(0);
    expect(b.parts.find(p => p.key === 'impressions')!.change).toBeCloseTo(0.25);
  });

  it('splits the ROAS change over CPC (inverted), conv. rate and AOV without remainder', () => {
    const b = roasBridge(cur, prev)!;
    expect(sum(b.parts)).toBeCloseTo(3 - 5, 9);
    expect(b.parts.find(p => p.key === 'cpc')!.amount).toBeLessThan(0);   // CPC 1,50 to 2,00 costs ROAS
  });

  it('gives zero parts when nothing changed, and null when a factor is missing', () => {
    expect(sum(revenueBridge(cur, cur)!.parts)).toBe(0);
    expect(revenueBridge(cur, sumRows([{ impressions: 10, clicks: 0 }]))).toBeNull();
  });

  it('makes the day count its own factor when the periods differ in length', () => {
    const b = revenueBridge(cur, prev, { current: 30, previous: 31 })!;
    expect(b.parts.map(p => p.key)).toEqual(['days', 'impressions', 'ctr', 'cvr', 'aov']);
    expect(sum(b.parts)).toBeCloseTo(300 - 360, 9);
    expect(b.parts[0].amount).toBeLessThan(0);                          // one day fewer
    expect(b.parts[1].change).toBeCloseTo((1000 / 30) / (800 / 31) - 1);  // impressions per day
    expect(revenueBridge(cur, prev, { current: 30, previous: 30 })!.parts[0].key).toBe('impressions');
  });

  it('ranks the largest parts by size in either direction', () => {
    const top = largestParts(revenueBridge(cur, prev)!, 2);
    expect(top).toHaveLength(2);
    expect(Math.abs(top[0].amount)).toBeGreaterThanOrEqual(Math.abs(top[1].amount));
  });
});
