import { describe, expect, it } from 'vitest';
import { accountToday, chooseGrain, fmtCount, derive, emptyTotals, groupBy, lagAwareRange, previousPeriod, previousYear, sumRows } from './metrics';

describe('derive', () => {
  it('computes ratios and leaves zero denominators null', () => {
    const d = derive({ ...emptyTotals(), impressions: 1000, clicks: 50, cost: 100, conversions: 4, conversions_value: 800 });
    expect(d.ctr).toBeCloseTo(0.05);
    expect(d.cpc).toBe(2);
    expect(d.cpa).toBe(25);
    expect(d.roas).toBe(8);
    expect(d.aov).toBe(200);
    expect(d.impression_share).toBeNull();
  });

  it('weights impression share by eligible impressions', () => {
    const rows = [
      { ...emptyTotals(), impressions: 500, is_impressions: 500, eligible_impressions: 1000, budget_lost_impressions: 400 },
      { ...emptyTotals(), impressions: 100, is_impressions: 100, eligible_impressions: 1000, budget_lost_impressions: 0 },
    ];
    const d = sumRows(rows);
    expect(d.impression_share).toBeCloseTo(0.3);
    expect(d.budget_lost_is).toBeCloseTo(0.2);
  });
});

describe('groupBy', () => {
  it('groups rows on a key', () => {
    const groups = groupBy([
      { category: 'A', cost: 10, conversions_value: 40 },
      { category: 'A', cost: 10, conversions_value: 20 },
      { category: 'B', cost: 5, conversions_value: 5 },
    ], r => r.category);
    expect(groups.get('A')?.roas).toBe(3);
    expect(groups.get('B')?.roas).toBe(1);
  });
});

describe('date helpers', () => {
  it('builds a lag-aware window', () => {
    const range = lagAwareRange(21, 30, new Date('2026-10-13T12:00:00Z'));
    expect(range).toEqual({ start: '2026-08-24', end: '2026-09-22' });
  });

  it('computes previous period and previous year', () => {
    expect(previousPeriod({ start: '2026-09-01', end: '2026-09-30' })).toEqual({ start: '2026-07-28', end: '2026-08-26' });
    expect(previousYear({ start: '2026-09-01', end: '2026-09-30' })).toEqual({ start: '2025-09-02', end: '2025-10-01' });
  });

  it('chooses a grain from the range length', () => {
    expect(chooseGrain({ start: '2026-09-01', end: '2026-09-30' })).toBe('day');
    expect(chooseGrain({ start: '2026-01-01', end: '2026-09-30' })).toBe('week');
    expect(chooseGrain({ start: '2024-01-01', end: '2026-09-30' })).toBe('month');
  });
});

describe('accountToday', () => {
  it('uses the Amsterdam date, not the UTC date', () => {
    // 1 Nov 2026 00:30 in Amsterdam (CET) is still 31 Oct in UTC.
    expect(accountToday(new Date('2026-10-31T23:30:00Z')).toISOString().slice(0, 10)).toBe('2026-11-01');
    // Summer time: 1 Jul 01:30 in Amsterdam is 30 Jun 23:30 UTC.
    expect(accountToday(new Date('2026-06-30T23:30:00Z')).toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(accountToday(new Date('2026-10-16T12:00:00Z')).toISOString().slice(0, 10)).toBe('2026-10-16');
  });
});

describe('fmtCount', () => {
  it('keeps decimals on small fractional counts only', () => {
    expect(fmtCount(0.01)).toBe('0.01');
    expect(fmtCount(5.2)).toBe('5.2');
    expect(fmtCount(3)).toBe('3');
    expect(fmtCount(841.63)).toBe('842');
    expect(fmtCount(0)).toBe('0');
  });
});
