import { describe, expect, it } from 'vitest';
import { calendarPrevious, compareRangeFor, resolveCompareRange } from './compareRange';
import { previousPeriod } from './metrics';

describe('previousPeriod', () => {
  it('shifts back by whole weeks so weekdays line up', () => {
    // 30 days -> 35 back: 1 Sep 2026 (Tue) compares with 28 Jul 2026 (Tue).
    expect(previousPeriod({ start: '2026-09-01', end: '2026-09-30' })).toEqual({ start: '2026-07-28', end: '2026-08-26' });
    expect(previousPeriod({ start: '2026-10-07', end: '2026-10-13' })).toEqual({ start: '2026-09-30', end: '2026-10-06' });
  });
});

describe('calendarPrevious', () => {
  it('compares a month with the previous calendar month, whatever its length', () => {
    expect(calendarPrevious('lastmonth', { start: '2026-09-01', end: '2026-09-30' })).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(calendarPrevious('lastmonth', { start: '2026-03-01', end: '2026-03-31' })).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
  it('compares month to date with the same days of the previous month, capped at its end', () => {
    expect(calendarPrevious('mtd', { start: '2026-10-01', end: '2026-10-13' })).toEqual({ start: '2026-09-01', end: '2026-09-13' });
    expect(calendarPrevious('mtd', { start: '2026-03-01', end: '2026-03-30' })).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
  it('compares quarter and year to date with the previous calendar unit', () => {
    expect(calendarPrevious('qtd', { start: '2026-10-01', end: '2026-10-13' })).toEqual({ start: '2026-07-01', end: '2026-07-13' });
    expect(calendarPrevious('ytd', { start: '2026-01-01', end: '2026-10-13' })).toEqual({ start: '2025-01-01', end: '2025-10-13' });
  });
  it('falls back to the weekday-aligned shift for rolling and custom presets', () => {
    expect(calendarPrevious('l30', { start: '2026-09-14', end: '2026-10-13' })).toEqual(previousPeriod({ start: '2026-09-14', end: '2026-10-13' }));
  });
});

describe('compareRangeFor and resolveCompareRange', () => {
  it('honours the mode', () => {
    expect(compareRangeFor('none', 'l30', { start: '2026-09-14', end: '2026-10-13' })).toBeNull();
    expect(compareRangeFor('year', 'lastmonth', { start: '2026-09-01', end: '2026-09-30' })).toEqual({ start: '2025-09-02', end: '2025-10-01' });
  });
  it('prefers an explicit range from the client', () => {
    const params = new URLSearchParams({ compare: 'previous', compareStart: '2026-08-01', compareEnd: '2026-08-31' });
    expect(resolveCompareRange(params, { start: '2026-09-01', end: '2026-09-30' })).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(resolveCompareRange(new URLSearchParams({ compare: 'previous', preset: 'lastmonth' }), { start: '2026-09-01', end: '2026-09-30' })).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  });
});
