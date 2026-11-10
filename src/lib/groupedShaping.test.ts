import { describe, expect, it } from 'vitest';
import { emptyTotals, FactRow } from './metrics';
import { displayNetwork } from './filters';
import { campaignRows, groupRows, groupTrend, sortNetworks, totalRow } from './groupedShaping';

const fact = (over: Partial<FactRow>): FactRow => ({
  account_id: '1', period: '2026-10-01', campaign_id: 'c1', campaign_name: '02 | Stoves', channel_type: 'SEARCH', status: 'ENABLED',
  network: 'Search', category: 'Stoves', bucket: '', target_roas: null, target_cpa: null,
  ...emptyTotals(), ...over,
});

const rows = [
  fact({ campaign_id: 'c1', period: '2026-10-01', cost: 100, conversions_value: 400, conversions: 4 }),
  fact({ campaign_id: 'c1', period: '2026-10-02', cost: 50, conversions_value: 100, conversions: 1 }),
  fact({ campaign_id: 'c2', campaign_name: '01 | Brand', category: 'Brand', period: '2026-10-01', cost: 20, conversions_value: 200, conversions: 2 }),
  fact({ campaign_id: 'c3', campaign_name: '08 | Lighting [H]', category: 'Lighting', network: 'PMax', channel_type: 'PERFORMANCE_MAX', period: '2026-10-02', cost: 30, conversions_value: 60, conversions: 1, status: 'PAUSED' }),
];
const compareRows = [
  fact({ campaign_id: 'c1', period: '2026-09-01', cost: 80, conversions_value: 240, conversions: 3 }),
  fact({ campaign_id: 'c9', campaign_name: '99 | Old', category: 'Old', period: '2026-09-01', cost: 10, conversions_value: 10, conversions: 1 }),
];

describe('groupRows', () => {
  it('groups by the key, keeps the previous period per group and sorts by cost', () => {
    const grouped = groupRows(rows, compareRows, displayNetwork);
    expect(grouped.map(r => r.name)).toEqual(['Non-Branded Search', 'Non-Branded Shopping', 'Branded Search']);
    expect(grouped[0]).toMatchObject({ cost: 150, conversions_value: 500 });
    expect(grouped[0].share).toBeCloseTo(500 / 760, 6);   // revenue share
    // c9 ("Oud") is Search as well, so it lands in the same previous group.
    expect(grouped[0].previous).toMatchObject({ cost: 90, conversions_value: 250 });
    expect(grouped[1].previous).toBeNull();
  });
  it('does not list groups that only exist in the comparison period', () => {
    expect(groupRows(rows, compareRows, r => r.category).map(r => r.name)).not.toContain('Old');
  });
  it('gives null shares when nothing was earned', () => {
    const grouped = groupRows([fact({ cost: 0 })], [], r => r.category);
    expect(grouped[0].share).toBeNull();
  });
});

describe('campaignRows', () => {
  it('carries display network, status and the previous period per campaign', () => {
    const campaigns = campaignRows(rows, compareRows);
    expect(campaigns.map(c => c.campaign_id)).toEqual(['c1', 'c3', 'c2']);
    expect(campaigns[0]).toMatchObject({ name: '02 | Stoves', network: 'Non-Branded Search', status: 'ENABLED', cost: 150 });
    expect(campaigns[0].share).toBeCloseTo(500 / 760, 6);
    expect(campaigns[0].previous).toMatchObject({ cost: 80 });
    expect(campaigns[1]).toMatchObject({ network: 'Non-Branded Shopping', status: 'PAUSED' });
    expect(campaigns[2]).toMatchObject({ network: 'Branded Search', previous: null });
  });
});

describe('totalRow', () => {
  it('sums the rows and the comparison rows', () => {
    const total = totalRow(rows, compareRows);
    expect(total).toMatchObject({ name: 'Total', cost: 200, conversions_value: 760, share: 1 });
    expect(total.roas).toBeCloseTo(3.8);
    expect(total.previous).toMatchObject({ cost: 90, conversions_value: 250 });
  });
  it('has no previous when there is no comparison', () => {
    expect(totalRow(rows, []).previous).toBeNull();
    expect(totalRow([], []).share).toBeNull();
  });
});

describe('sortNetworks', () => {
  it('follows the fixed network order and puts unknown networks last', () => {
    expect(sortNetworks(['Non-Branded Shopping', 'Zzz', 'Branded Search', 'Non-Branded Search', 'Branded Shopping'])).toEqual(['Branded Search', 'Branded Shopping', 'Non-Branded Search', 'Non-Branded Shopping', 'Zzz']);
  });
});

describe('groupTrend', () => {
  it('keeps the top groups by cost and gives one point per period', () => {
    const trend = groupTrend(rows, r => r.campaign_name, 'cost', 2);
    expect(trend.names).toEqual(['02 | Stoves', '08 | Lighting [H]']);
    expect(trend.points).toEqual([
      { period: '2026-10-01', '02 | Stoves': 100, '08 | Lighting [H]': null },
      { period: '2026-10-02', '02 | Stoves': 50, '08 | Lighting [H]': 30 },
    ]);
  });
  it('derives ratios per period from the group totals', () => {
    const trend = groupTrend(rows, displayNetwork, 'roas');
    expect(trend.names).toEqual(['Non-Branded Search', 'Non-Branded Shopping', 'Branded Search']);
    expect(trend.points[0]['Non-Branded Search']).toBeCloseTo(4);
    expect(trend.points[1]['Non-Branded Search']).toBeCloseTo(2);
    expect(trend.points[1]['Branded Search']).toBeNull();
  });
  it('returns nothing for no rows', () => {
    expect(groupTrend([], r => r.category, 'cost')).toEqual({ names: [], points: [] });
  });
});
