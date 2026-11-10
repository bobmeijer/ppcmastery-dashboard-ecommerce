import { describe, expect, it } from 'vitest';
import { derive, emptyTotals } from './metrics';
import { PeriodPoint, rollingBand, rollingPeriods } from './reportShaping';

const point = (period: string, cost: number, value: number, clicks: number): PeriodPoint =>
  ({ period, ...derive({ ...emptyTotals(), cost, conversions_value: value, clicks, impressions: clicks * 100, conversions: 1 }) });

describe('rollingBand', () => {
  it('flags values outside mean plus or minus k sd of the trailing window', () => {
    const values = [10, 10, 10, 10, 10, 10, 40];
    const band = rollingBand(values, 4, 1.5);
    expect(band[2]).toEqual({ low: null, high: null, anomaly: false });
    expect(band[3]).toEqual({ low: 10, high: 10, anomaly: false });
    expect(band[6].anomaly).toBe(true);
    expect(band[6].high).toBeGreaterThan(10);
  });
});

describe('rollingPeriods', () => {
  const points = [point('d1', 100, 200, 10), point('d2', 100, 400, 30), point('d3', 400, 600, 20), point('d4', 200, 800, 40)];

  it('returns the points themselves for a window of one', () => {
    expect(rollingPeriods(points, 1).map(r => r.value?.cost)).toEqual([100, 100, 400, 200]);
  });
  it('averages additive metrics per period and derives ratios from the averaged totals', () => {
    const rolled = rollingPeriods(points, 2);
    expect(rolled[0].value).toBeNull();
    expect(rolled[1].value?.cost).toBe(100);
    expect(rolled[1].value?.conversions_value).toBe(300);
    expect(rolled[1].value?.roas).toBeCloseTo(3, 6);           // 600 / 200, not the mean of 2 and 4
    expect(rolled[2].value?.cpc).toBeCloseTo(500 / 50, 6);      // (100 + 400) / (30 + 20)
    expect(rolled[3].value?.ctr).toBeCloseTo(0.01, 6);
  });
  it('keeps nulls until the window is full', () => {
    expect(rollingPeriods(points, 4).map(r => r.value === null)).toEqual([true, true, true, false]);
  });
});
