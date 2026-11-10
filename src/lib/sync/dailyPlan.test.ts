import { describe, expect, it } from 'vitest';
import { dailySteps, hasTimeLeft, TIME_BUDGET_MS } from './dailyPlan';

const off = { microsoftAds: false, feedStatus: false, auctionInsights: false, changeHistory: false, qualityScore: false, communications: false, ai: false };

describe('dailySteps', () => {
  it('runs only the Google facts when every module is off, campaign first', () => {
    const steps = dailySteps(off);
    expect(steps.map(s => s.query)).toEqual(['dataset=campaign', 'dataset=conversions', 'dataset=geo', 'dataset=device', 'dataset=product']);
    expect(new Set(steps.map(s => s.handler))).toEqual(new Set(['google-ads']));
  });

  it('adds a module only when it is on', () => {
    const steps = dailySteps({ ...off, feedStatus: true, changeHistory: true });
    expect(steps.some(s => s.handler === 'feed')).toBe(true);
    expect(steps.some(s => s.query === 'dataset=changes')).toBe(true);
    expect(steps.some(s => s.query === 'dataset=quality')).toBe(false);
    expect(steps.some(s => s.handler === 'microsoft-ads')).toBe(false);
  });

  it('runs the paid AI step last', () => {
    const on = Object.fromEntries(Object.keys(off).map(k => [k, true])) as typeof off;
    expect(dailySteps(on).at(-1)?.handler).toBe('insights');
  });
});

describe('hasTimeLeft', () => {
  it('stops starting steps at the budget', () => {
    expect(hasTimeLeft(TIME_BUDGET_MS - 1)).toBe(true);
    expect(hasTimeLeft(TIME_BUDGET_MS)).toBe(false);
  });
});
