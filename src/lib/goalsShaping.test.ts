import { describe, expect, it } from 'vitest';
import { completePeriods, completeWindow, dailyGoal, goalForDays, periodGoalViews } from './goalsShaping';
import { derive, emptyTotals } from './metrics';
import type { PeriodPoint } from './reportShaping';

const today = new Date('2026-10-14T09:00:00Z');   // lag 21 -> cutoff 2026-09-23
const goals = { revenuePerMonth: 300000, roas: 4 };

const point = (period: string, cost: number, value: number): PeriodPoint => ({ period, ...derive({ ...emptyTotals(), cost, conversions_value: value, conversions: 1, clicks: 1, impressions: 1 }) });

const days = (start: string, n: number, cost = 1000, value = 10000): PeriodPoint[] => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return point(d.toISOString().slice(0, 10), cost, value);
});

describe('completeWindow', () => {
  it('cuts the range at today minus the lag', () => {
    expect(completeWindow({ start: '2026-09-14', end: '2026-10-13' }, 21, today)).toEqual({ start: '2026-09-14', end: '2026-09-23', days: 10 });
  });
  it('keeps a range that ends before the cutoff whole', () => {
    expect(completeWindow({ start: '2026-08-01', end: '2026-08-31' }, 21, today)).toEqual({ start: '2026-08-01', end: '2026-08-31', days: 31 });
  });
  it('is null when every day sits inside the lag', () => {
    expect(completeWindow({ start: '2026-10-07', end: '2026-10-13' }, 21, today)).toBeNull();
  });
});

describe('dailyGoal', () => {
  it('spreads a monthly goal over an average day', () => {
    expect(dailyGoal(300000)).toBeCloseTo(9856.26, 1);
  });
});

describe('goalForDays', () => {
  it('uses the real length of each month', () => {
    expect(goalForDays(300000, '2026-09-01', 25)).toBeCloseTo(250000, 6);
    expect(goalForDays(300000, '2026-02-01', 28)).toBeCloseTo(300000, 6);
    // 30 + 31 = two full months across a boundary
    expect(goalForDays(300000, '2026-09-01', 61)).toBeCloseTo(600000, 6);
  });
});

describe('completePeriods', () => {
  const window = { start: '2026-09-14', end: '2026-09-23', days: 10 };
  it('keeps daily rows through the window end', () => {
    const { rows, days: n } = completePeriods(days('2026-09-14', 30), 'day', window);
    expect(rows).toHaveLength(10);
    expect(n).toBe(10);
  });
  it('drops a week bucket that straddles the cutoff and shrinks the day count with it', () => {
    const weeks = [point('2026-09-14', 1, 1), point('2026-09-21', 1, 1), point('2026-09-28', 1, 1)];
    const { rows, days: n } = completePeriods(weeks, 'week', window);
    expect(rows.map(r => r.period)).toEqual(['2026-09-14']);
    expect(n).toBe(7);
  });
});

describe('periodGoalViews', () => {
  const range = { start: '2026-09-14', end: '2026-10-13' };
  it('pro-rates the revenue goal to the complete days and judges both goals', () => {
    const views = periodGoalViews(days('2026-09-14', 30, 2500, 12000), [], 'day', range, 21, goals, today);
    expect(views).not.toBeNull();
    expect(views!.days).toBe(10);
    expect(views!.lagDaysInRange).toBe(20);
    expect(views!.revenue.actual).toBe(120000);
    expect(views!.revenue.expected).toBeCloseTo(100000, 0);
    expect(views!.revenue.status).toBe('good');
    expect(views!.roas.actual).toBeCloseTo(4.8, 5);
    expect(views!.roas.status).toBe('good');
  });
  it('flags below goal and below floor and slices the comparison alike', () => {
    const views = periodGoalViews(days('2026-09-14', 30, 4000, 8000), days('2026-08-15', 30, 1000, 10000), 'day', range, 21, goals, today);
    expect(views!.revenue.status).toBe('bad');
    expect(views!.roas.status).toBe('bad');
    expect(views!.revenue.compare).toBe(100000);
    expect(views!.roas.compare).toBe(10);
  });
  it('is null when the period has no complete day', () => {
    expect(periodGoalViews(days('2026-10-07', 7), [], 'day', { start: '2026-10-07', end: '2026-10-13' }, 21, goals, today)).toBeNull();
  });

  it('matches comparison days on dates, not on position (a missing day does not shift the slice)', () => {
    const range = { start: '2026-09-01', end: '2026-09-30' };
    const compare = days('2026-08-02', 30, 100, 1000).filter(p => p.period !== '2026-08-03');
    const views = periodGoalViews(days('2026-09-01', 30, 100, 1000), compare, 'day', range, 21, goals, today, '2026-08-02');
    // 23 complete days (1-23 Sep, cutoff from today) against 2-24 Aug with 3 Aug missing: 22 days of 1000.
    // By position the old code took 23 rows and reached 25 Aug.
    expect(views!.revenue.compare).toBe(22 * 1000);
  });
});
