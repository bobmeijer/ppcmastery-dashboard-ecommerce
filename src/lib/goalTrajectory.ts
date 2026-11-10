// Round 10 ended with the meters (GoalMeters.tsx); the scatter,
// strips and verdict UI were deleted. This pure module stays for two reasons:
// the rolling 4-week average is backlog for Trends, and the constraint verdict
// may return as a sentence under the meters.
//
// Origin: the two goals read as one point in spend x
// revenue space (where the 400% ray meets the revenue goal), a rolling 4-week
// trajectory instead of a snapshot, and a "binding constraint" verdict:
// either ROAS sits below the floor (efficiency binds) or it does not (growth
// binds). There is NO spend ceiling and no budget
// steering; spend is never judged against a target. Pure, tested in
// goalTrajectory.test.ts. No profit, margin or POAS.
import { sumRows } from './metrics';
import { CompleteWindow, completePeriods, dailyGoal, GoalStatus, Grain } from './goalsShaping';
import type { PeriodPoint } from './reportShaping';
import type { AccountGoals } from '@/lib/accountGoals';

// --- the goal point ---------------------------------------------------------------

export const weeklyGoal = (revenuePerMonth: number) => dailyGoal(revenuePerMonth) * 7;

// Where the floor ray meets the weekly revenue goal: the one point where both goals hold.
// A coordinate for the chart, not a spend target.
export const weeklyGoalPoint = (goals: AccountGoals) => ({ spend: goals.roas > 0 ? weeklyGoal(goals.revenuePerMonth) / goals.roas : 0, revenue: weeklyGoal(goals.revenuePerMonth) });
export const proRatedRevenueGoal = (goals: AccountGoals, days: number) => dailyGoal(goals.revenuePerMonth) * days;

// --- weeks ------------------------------------------------------------------------

// ISO week number: Monday start, the week's Thursday decides the year.
export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

export const weekLabel = (iso: string) => `wk ${isoWeek(iso)}`;

export interface WeekView {
  period: string;             // Monday of the week
  label: string;              // "wk 38"
  spend: number;
  revenue: number;
  roas: number | null;
  revenueStatus: GoalStatus;  // vs the weekly goal
  roasStatus: GoalStatus | null;
}

export function weekViews(weeks: PeriodPoint[], goals: AccountGoals): WeekView[] {
  const goal = weeklyGoal(goals.revenuePerMonth);
  return weeks.map(w => ({
    period: w.period,
    label: weekLabel(w.period),
    spend: w.cost,
    revenue: w.conversions_value,
    roas: w.roas,
    revenueStatus: w.conversions_value >= goal ? 'good' : 'bad',
    roasStatus: w.roas === null ? null : w.roas >= goals.roas ? 'good' : 'bad',
  }));
}

export const lastWeeks = <T>(weeks: T[], n = 12): T[] => weeks.slice(Math.max(0, weeks.length - n));

// Rolling average over the trailing `size` weeks (a 4-week average, not a
// single week). Each entry covers the week itself plus the
// previous size - 1 weeks; the first size - 1 weeks are dropped because their
// window is incomplete. ROAS is the ratio of the summed values, never an average
// of ratios.
export function rollingWeekViews(weeks: PeriodPoint[], goals: AccountGoals, size = 4): WeekView[] {
  const goal = weeklyGoal(goals.revenuePerMonth);
  const out: WeekView[] = [];
  for (let i = size - 1; i < weeks.length; i += 1) {
    const slice = weeks.slice(i - size + 1, i + 1);
    const spend = slice.reduce((acc, w) => acc + w.cost, 0) / size;
    const revenue = slice.reduce((acc, w) => acc + w.conversions_value, 0) / size;
    const roas = spend > 0 ? revenue / spend : null;
    out.push({
      period: weeks[i].period,
      label: weekLabel(weeks[i].period),
      spend, revenue, roas,
      revenueStatus: revenue >= goal ? 'good' : 'bad',
      roasStatus: roas === null ? null : roas >= goals.roas ? 'good' : 'bad',
    });
  }
  return out;
}

// --- the selected period ---------------------------------------------------------

export interface PeriodTotals {
  spend: number;
  revenue: number;
  roas: number | null;
  days: number;               // complete days actually covered
}

// Spend and revenue of the complete periods inside the window (same slice that
// periodGoalViews judges, which does not expose spend).
export function completeTotals(periods: PeriodPoint[], grain: Grain, window: CompleteWindow): PeriodTotals {
  const { rows, days } = completePeriods(periods, grain, window);
  const t = sumRows(rows);
  return { spend: t.cost, revenue: t.conversions_value, roas: t.roas, days };
}

// The complete days of the period as one average week, for the scatter.
export const averageWeek = (t: PeriodTotals): { spend: number; revenue: number } | null =>
  t.days > 0 ? { spend: (t.spend / t.days) * 7, revenue: (t.revenue / t.days) * 7 } : null;

// --- the verdict --------------------------------------------------------------------

export type Constraint = 'roas' | 'growth';

export interface ConstraintVerdict {
  constraint: Constraint;
  days: number;
  spend: number;
  revenue: number;
  roas: number;
  floor: number;
  revenueGoal: number;        // pro-rated to the complete days
  revenueDiff: number;        // revenue - goal
  roasDiff: number;           // roas - floor, in ratio units (0.57 = 57 points)
  revenueFraction: number;    // revenue / goal
  spendAtFloor: number;       // revenue / floor: the spend the current revenue justifies
  spendRoom: number;          // spendAtFloor - spend (negative = excess spend)
  revenueAtFloor: number;     // spend * floor: the revenue the current spend demands
  roasLift: number;           // relative rise needed at current spend (0 when above the floor)
}

// Null when there is no spend: nothing to judge.
export function constraintVerdict(t: PeriodTotals, goals: AccountGoals): ConstraintVerdict | null {
  if (t.spend <= 0 || t.roas === null || goals.roas <= 0 || t.days <= 0) return null;
  const revenueGoal = proRatedRevenueGoal(goals, t.days);
  const spendAtFloor = t.revenue / goals.roas;
  return {
    constraint: t.roas < goals.roas ? 'roas' : 'growth',
    days: t.days,
    spend: t.spend,
    revenue: t.revenue,
    roas: t.roas,
    floor: goals.roas,
    revenueGoal,
    revenueDiff: t.revenue - revenueGoal,
    roasDiff: t.roas - goals.roas,
    revenueFraction: revenueGoal > 0 ? t.revenue / revenueGoal : 0,
    spendAtFloor,
    spendRoom: spendAtFloor - t.spend,
    revenueAtFloor: t.spend * goals.roas,
    roasLift: t.roas < goals.roas && t.roas > 0 ? goals.roas / t.roas - 1 : 0,
  };
}
