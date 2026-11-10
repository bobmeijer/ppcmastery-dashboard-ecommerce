// Monthly goals per account come from the targets table, through /api/report/goals.

export interface AccountGoals {
  revenuePerMonth: number;   // conversion value per calendar month
  roas: number;              // blended ROAS floor as a ratio (4 = 400%)
}
