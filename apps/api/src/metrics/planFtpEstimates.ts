import type { CoachPlan, WeekPlan } from "@killingit/shared";

/**
 * The coach's daily FTP estimates for the days the stored weeks cover, from
 * today onward. Each session carries the day's projection; a session without
 * one falls back to its week's single estimate. The points are stored as coach
 * values in `athlete_metrics` so the Fitness page can chart the projection day
 * by day.
 */
export function planFtpEstimates(
  plan: CoachPlan,
): { date: string; watts: number }[] {
  const today = plan.today.date;
  const estimates = new Map<string, number>();
  const addWeek = (week: WeekPlan | null): void => {
    if (week === null) {
      return;
    }
    for (const session of week.sessions) {
      if (session.date < today) {
        continue;
      }
      const watts = session.estimatedFtpWatts ?? week.estimatedFtpWatts;
      if (watts != null && watts > 0) {
        estimates.set(session.date, watts);
      }
    }
  };
  addWeek(plan.week);
  addWeek(plan.nextWeek);
  return [...estimates]
    .map(([date, watts]) => ({ date, watts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
