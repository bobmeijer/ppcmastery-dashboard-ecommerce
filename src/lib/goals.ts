// Goals per account for the AI analysis, read from the targets table: whichever of
// revenue_per_month, purchases_per_month, roas and cpa is valid on the given day.
// Goals are Google Ads targets (platform.ts, targetsApply).
import { activeTarget } from './reportShaping';
import type { TargetRow } from './reports';

export interface AccountGoals {
  revenuePerMonth: number | null;     // EUR conversion value per calendar month
  purchasesPerMonth: number | null;   // conversions per calendar month
  roas: number | null;                // ROAS floor as a ratio (4 = 400%)
  cpa: number | null;                 // EUR per conversion, a ceiling
}

export function goalsFor(targets: TargetRow[], accountId: string | null, asOf: string): AccountGoals | null {
  if (!accountId) return null;
  const value = (metric: string) => { const t = activeTarget(targets, accountId, metric, asOf); return t ? Number(t.value) : null; };
  const goals = { revenuePerMonth: value('revenue_per_month'), purchasesPerMonth: value('purchases_per_month'), roas: value('roas'), cpa: value('cpa') };
  return Object.values(goals).some(v => v !== null) ? goals : null;
}
