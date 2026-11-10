import type { ModuleKey } from '../../../dashboard.config';

// What the one daily job runs, most important first, because a run that hits the time
// limit drops whatever is left. Pure, so it can be tested.

export type DailyHandler = 'google-ads' | 'microsoft-ads' | 'feed' | 'auction' | 'insights';
export interface DailyStep { handler: DailyHandler; query: string }

export const TIME_BUDGET_MS = 240_000;

const FACTS = ['campaign', 'conversions', 'geo', 'device', 'product'];

export function dailySteps(modules: Record<ModuleKey, boolean>): DailyStep[] {
  const steps: DailyStep[] = FACTS.map(dataset => ({ handler: 'google-ads', query: `dataset=${dataset}` }));
  if (modules.changeHistory) steps.push({ handler: 'google-ads', query: 'dataset=changes' });
  if (modules.qualityScore) steps.push({ handler: 'google-ads', query: 'dataset=quality' });
  if (modules.microsoftAds) {
    steps.push(...FACTS.map((dataset): DailyStep => ({ handler: 'microsoft-ads', query: `dataset=${dataset}` })));
  }
  if (modules.feedStatus) steps.push({ handler: 'feed', query: '' });
  if (modules.auctionInsights) steps.push({ handler: 'auction', query: '' });
  if (modules.ai) steps.push({ handler: 'insights', query: '' });
  return steps;
}

// A step only starts while there is room for it to finish inside the function limit.
export const hasTimeLeft = (elapsedMs: number) => elapsedMs < TIME_BUDGET_MS;
