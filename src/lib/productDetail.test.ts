import { describe, expect, it } from 'vitest';
import { dailyPoints, labelPeriods, periodTotals, ProductDayRow, splitBy, trendPoints } from './productDetail';

const day = (date: string, over: Partial<ProductDayRow> = {}): ProductDayRow => ({
  date, campaign_id: '1', campaign_name: '08 | Garden Chairs [H+S]', campaign_bucket: 'H+S', country_code: 'NL', label: 'heroes',
  impressions: 100, clicks: 10, cost: 300, conversions: 1, conversions_value: 900, ...over,
});

// Hero on 2 and 3 Oct, nothing on 4 and 5, villain from 6 Oct in the V+Z campaign.
const rows: ProductDayRow[] = [
  day('2026-10-02'),
  day('2026-10-03', { country_code: 'BE', cost: '100', conversions_value: 0, conversions: 0 }),
  day('2026-10-06', { campaign_id: '2', campaign_name: '08 | Garden Chairs [V+Z]', campaign_bucket: 'V+Z', label: 'villains', cost: 80, conversions_value: 0, conversions: 0 }),
  day('2026-10-07', { campaign_id: '2', campaign_name: '08 | Garden Chairs [V+Z]', campaign_bucket: 'V+Z', label: 'villains', cost: 60, conversions_value: 300 }),
];
const points = dailyPoints(rows, '2026-10-01', '2026-10-07');

describe('dailyPoints', () => {
  it('fills every day and carries the last known label through empty days', () => {
    expect(points.map(p => [p.date, p.label, p.carried, p.cost])).toEqual([
      ['2026-10-01', null, null, 0],
      ['2026-10-02', 'H', 'H', 300],
      ['2026-10-03', 'H', 'H', 100],
      ['2026-10-04', null, 'H', 0],
      ['2026-10-05', null, 'H', 0],
      ['2026-10-06', 'V', 'V', 80],
      ['2026-10-07', 'V', 'V', 60],
    ]);
  });

  it('picks the label with most weight on a mixed day', () => {
    const mixed = dailyPoints([day('2026-10-01', { impressions: 10, cost: 1 }), day('2026-10-01', { label: 'villains', impressions: 500, cost: 50 })], '2026-10-01', '2026-10-01');
    expect(mixed[0].label).toBe('V');
  });
});

describe('labelPeriods', () => {
  it('turns days into label runs with cost per active day', () => {
    expect(labelPeriods(points).map(p => [p.label, p.start, p.end, p.days, p.activeDays, p.cost, p.costPerDay, p.roas])).toEqual([
      ['H', '2026-10-02', '2026-10-05', 4, 2, 400, 200, 2.25],
      ['V', '2026-10-06', '2026-10-07', 2, 2, 140, 70, 2.1429],
    ]);
  });
});

describe('trendPoints', () => {
  it('buckets per Monday week and marks cut weeks', () => {
    const weeks = trendPoints(points, 'week');
    expect(weeks.map(w => [w.period, w.cost, !!w.partial])).toEqual([['2026-09-28', 400, true], ['2026-10-05', 140, true]]);
    expect(trendPoints(points, 'day')).toHaveLength(7);
  });
});

describe('splits and totals', () => {
  it('splits per campaign with bucket and per country inside the period', () => {
    expect(splitBy(rows, '2026-10-01', '2026-10-07', 'campaign').map(s => [s.name, s.bucket, s.cost])).toEqual([
      ['08 | Garden Chairs [H+S]', 'H+S', 400], ['08 | Garden Chairs [V+Z]', 'V+Z', 140],
    ]);
    expect(splitBy(rows, '2026-10-03', '2026-10-07', 'country').map(s => [s.name, s.cost])).toEqual([['NL', 140], ['BE', 100]]);
  });

  it('sums a sub-period', () => {
    expect(periodTotals(points, '2026-10-06', '2026-10-07')).toMatchObject({ cost: 140, conversions_value: 300 });
  });
});
