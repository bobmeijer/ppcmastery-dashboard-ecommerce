import { describe, expect, it } from 'vitest';
import {
  averageWeek, completeTotals, constraintVerdict, isoWeek, lastWeeks, rollingWeekViews, weeklyGoal, weeklyGoalPoint, weekLabel, weekViews,
} from './goalTrajectory';
import { derive, emptyTotals } from './metrics';
import type { PeriodPoint } from './reportShaping';

const goals = { revenuePerMonth: 300000, roas: 4 };

const point = (period: string, cost: number, value: number): PeriodPoint => ({ period, ...derive({ ...emptyTotals(), cost, conversions_value: value, conversions: 1, clicks: 1, impressions: 1 }) });

describe('goal point', () => {
  it('derives the weekly goal from the daily goal', () => {
    expect(weeklyGoal(300000)).toBeCloseTo(68993.8, 0);
  });
  it('places the goal point where the floor ray meets the weekly goal', () => {
    const p = weeklyGoalPoint(goals);
    expect(p.revenue).toBeCloseTo(68993.8, 0);
    expect(p.spend).toBeCloseTo(17248.5, 0);
  });
});

describe('weeks', () => {
  it('labels ISO weeks', () => {
    expect(isoWeek('2026-09-14')).toBe(38);
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2024-12-30')).toBe(1);
    expect(weekLabel('2026-06-29')).toBe('wk 27');
  });
  it('judges each week against the weekly goal and the floor', () => {
    const views = weekViews([point('2026-09-07', 20000, 90000), point('2026-09-14', 27000, 60000)], goals);
    expect(views[0]).toMatchObject({ label: 'wk 37', spend: 20000, revenue: 90000, revenueStatus: 'good', roasStatus: 'good' });
    expect(views[0].roas).toBeCloseTo(4.5, 5);
    expect(views[1]).toMatchObject({ label: 'wk 38', revenueStatus: 'bad', roasStatus: 'bad' });
  });
  it('rolls four weeks into one point and drops the first three', () => {
    const weeks = [point('2026-08-24', 10000, 30000), point('2026-08-31', 10000, 50000), point('2026-09-07', 20000, 90000), point('2026-09-14', 20000, 70000), point('2026-09-21', 20000, 30000)];
    const views = rollingWeekViews(weeks, goals);
    expect(views.map(v => v.label)).toEqual(['wk 38', 'wk 39']);
    expect(views[0]).toMatchObject({ spend: 15000, revenue: 60000, revenueStatus: 'bad', roasStatus: 'good' });
    expect(views[0].roas).toBeCloseTo(4, 6);
    expect(views[1]).toMatchObject({ spend: 17500, revenue: 60000, roasStatus: 'bad' });
  });
  it('keeps the last n weeks', () => {
    expect(lastWeeks([1, 2, 3, 4], 3)).toEqual([2, 3, 4]);
    expect(lastWeeks([1, 2], 3)).toEqual([1, 2]);
  });
});

describe('completeTotals', () => {
  it('sums only the complete days and reports the day count', () => {
    const days = Array.from({ length: 20 }, (_, i) => point(`2026-09-${String(i + 1).padStart(2, '0')}`, 1000, 3000));
    const t = completeTotals(days, 'day', { start: '2026-09-01', end: '2026-09-10', days: 10 });
    expect(t).toEqual({ spend: 10000, revenue: 30000, roas: 3, days: 10 });
    expect(averageWeek(t)).toEqual({ spend: 7000, revenue: 21000 });
  });
  it('has no average week without days', () => {
    expect(averageWeek({ spend: 0, revenue: 0, roas: null, days: 0 })).toBeNull();
  });
});

describe('constraintVerdict', () => {
  it('names ROAS the constraint below the floor and sizes the two ways out', () => {
    // Shop A, last 30 days: 107k spend, 275k revenue, 257% ROAS.
    const v = constraintVerdict({ spend: 107000, revenue: 275000, roas: 275000 / 107000, days: 30 }, goals)!;
    expect(v.constraint).toBe('roas');
    expect(v.roasLift).toBeCloseTo(4 / (275000 / 107000) - 1, 6);   // ROAS must rise ~56%
    expect(v.spendAtFloor).toBe(68750);                             // only 68.750 spend fits at 400%
    expect(v.spendRoom).toBe(68750 - 107000);
    expect(v.revenueAtFloor).toBe(428000);
    expect(v.revenueGoal).toBeCloseTo(295687.9, 0);
    expect(v.revenueFraction).toBeCloseTo(0.93, 2);
  });
  it('names growth the constraint above the floor', () => {
    const v = constraintVerdict({ spend: 50000, revenue: 230000, roas: 4.6, days: 30 }, goals)!;
    expect(v.constraint).toBe('growth');
    expect(v.roasDiff).toBeCloseTo(0.6, 6);
    expect(v.roasLift).toBe(0);
    expect(v.spendRoom).toBe(57500 - 50000);
  });
  it('has nothing to say without spend', () => {
    expect(constraintVerdict({ spend: 0, revenue: 0, roas: null, days: 10 }, goals)).toBeNull();
  });
  it('reports a met goal with a positive revenue difference', () => {
    const v = constraintVerdict({ spend: 60000, revenue: 320000, roas: 320000 / 60000, days: 30 }, goals)!;
    expect(v.constraint).toBe('growth');
    expect(v.revenueDiff).toBeGreaterThan(0);
  });
});
