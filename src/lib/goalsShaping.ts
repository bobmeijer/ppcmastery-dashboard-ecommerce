// Pure helpers for the account goals (growth: revenue per month, efficiency:
// blended ROAS floor), measured on the COMPLETE days of the selected period
//: the conversion lag window at the end of the period is
// left out, and the monthly revenue goal is pro-rated to the complete days.
// No profit, margin or POAS anywhere.
import { addDays, accountToday, DateRange, daysBetween, Derived, lagCutoff, sumRows } from './metrics';
import type { PeriodPoint } from './reportShaping';
import type { AccountGoals } from '@/lib/accountGoals';

export type Grain = 'day' | 'week' | 'month';

export interface CompleteWindow { start: string; end: string; days: number }

// The part of the range that lies outside the lag window. Null when every day
// of the range still sits inside the lag.
export function completeWindow(range: DateRange, lagDays: number, today = accountToday()): CompleteWindow | null {
  const cutoff = lagCutoff(lagDays, today);
  const end = range.end < cutoff ? range.end : cutoff;
  if (end < range.start) return null;
  return { start: range.start, end, days: daysBetween(range.start, end) };
}

// A month's goal spread over an average day (300.000 per month = 9.856 per day).
export const dailyGoal = (perMonth: number) => (perMonth * 12) / 365.25;

// The monthly goal for `days` days from `start`, each day carrying its own month's
// share: 1-25 Sep = 25/30 of 300.000 = 250.000, so the meter matches
// "pro-rated goal of 300,000 per month" instead of an average 30,4-day month.
export function goalForDays(perMonth: number, start: string, days: number): number {
  let total = 0;
  for (let i = 0; i < days; i += 1) {
    const d = new Date(`${addDays(start, i)}T00:00:00Z`);
    total += perMonth / new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  }
  return total;
}

const bucketEnd = (period: string, grain: Grain): string => {
  if (grain === 'day') return period;
  const d = new Date(`${period}T00:00:00Z`);
  if (grain === 'week') d.setUTCDate(d.getUTCDate() + 6); else d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};

// The periods that end inside the complete window, plus the number of days they
// actually cover (a week or month bucket that straddles the cutoff is dropped,
// so the day count shrinks with it).
export function completePeriods<T extends { period: string }>(periods: T[], grain: Grain, window: CompleteWindow): { rows: T[]; days: number } {
  const rows = periods.filter(p => bucketEnd(p.period, grain) <= window.end);
  if (rows.length === 0) return { rows, days: 0 };
  const last = bucketEnd(rows[rows.length - 1].period, grain);
  return { rows, days: daysBetween(window.start, last < window.end ? last : window.end) };
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export type GoalStatus = 'good' | 'bad';

export interface RevenueGoalView {
  actual: number;
  expected: number;           // pro-rated goal for the complete days
  fraction: number;           // actual / expected, not clamped
  status: GoalStatus;
  compare: number | null;     // same complete slice of the comparison period
}

export interface RoasGoalView {
  actual: number | null;
  floor: number;
  fraction: number;           // actual / floor, not clamped
  status: GoalStatus | null;
  compare: number | null;
}

export interface PeriodGoalViews {
  window: CompleteWindow;
  days: number;               // complete days actually covered by the rows
  lagDaysInRange: number;     // days of the range still inside the lag window
  revenue: RevenueGoalView;
  roas: RoasGoalView;
  totals: Derived;            // the complete days, for the contribution split
  compareTotals: Derived | null;
}

// The complete days of the period and the same number of comparison periods:
// the lag-free slice the goals and the contribution split are measured on.
export interface CompleteSlice {
  window: CompleteWindow;
  days: number;               // complete days actually covered by the rows
  lagDaysInRange: number;     // days of the range still inside the lag window
  totals: Derived;
  compareTotals: Derived | null;
}

// compareStart: first day of the comparison range. The comparison slice is the same
// number of days from there, matched on dates: a comparison day without rows (a
// filtered campaign that did not run) must not shift the slice.
export function completeSlice(
  periods: PeriodPoint[], comparePeriods: PeriodPoint[], grain: Grain, range: DateRange, lagDays: number, today = accountToday(),
  compareStart?: string | null,
): CompleteSlice | null {
  const window = completeWindow(range, lagDays, today);
  if (!window) return null;
  const { rows, days } = completePeriods(periods, grain, window);
  if (rows.length === 0 || days === 0) return null;
  return {
    window, days,
    lagDaysInRange: daysBetween(range.start, range.end) - window.days,
    totals: sumRows(rows),
    compareTotals: !comparePeriods.length ? null
      : compareStart ? sumRows(comparePeriods.filter(p => bucketEnd(p.period, grain) <= addDays(compareStart, days - 1)))
      : sumRows(comparePeriods.slice(0, rows.length)),
  };
}

export function periodGoalViews(
  periods: PeriodPoint[], comparePeriods: PeriodPoint[], grain: Grain, range: DateRange, lagDays: number, goals: AccountGoals, today = accountToday(),
  compareStart?: string | null,
): PeriodGoalViews | null {
  const slice = completeSlice(periods, comparePeriods, grain, range, lagDays, today, compareStart);
  if (!slice) return null;
  const { window, days, totals, compareTotals: compare } = slice;
  const expected = goalForDays(goals.revenuePerMonth, window.start, days);
  const actual = totals.conversions_value;
  const roas = totals.roas;
  return {
    window,
    days,
    lagDaysInRange: slice.lagDaysInRange,
    revenue: {
      actual, expected,
      fraction: expected > 0 ? actual / expected : 0,
      status: actual >= expected ? 'good' : 'bad',
      compare: compare ? compare.conversions_value : null,
    },
    roas: {
      actual: roas, floor: goals.roas,
      fraction: roas === null || goals.roas <= 0 ? 0 : roas / goals.roas,
      status: roas === null ? null : roas >= goals.roas ? 'good' : 'bad',
      compare: compare ? compare.roas : null,
    },
    totals,
    compareTotals: compare,
  };
}

// Where the period range would have to start for at least one complete day.
export const latestCompleteStart = (lagDays: number, today = accountToday()) => lagCutoff(lagDays, today);

export const nextDayIso = (iso: string) => addDays(iso, 1);
