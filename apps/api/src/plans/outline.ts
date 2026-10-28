import type { CoachPlan, WeekPlan } from "@killingit/shared";
import { addDays } from "./dates.js";

/**
 * Enforces the week-outline contract: days after tomorrow never carry a
 * structured trainer workout. The coach prescribes intervals only for today and
 * tomorrow; later days are outlines that the daily update fills in when they
 * arrive. Today, tomorrow, and past days keep any workout they already have.
 */
export function outlineFutureSessions(
  plan: CoachPlan,
  today: string,
): CoachPlan {
  const lastDetailedDate = addDays(today, 1);
  return {
    ...plan,
    week: stripBikeWorkoutsAfter(plan.week, lastDetailedDate),
    nextWeek:
      plan.nextWeek === null
        ? null
        : stripBikeWorkoutsAfter(plan.nextWeek, lastDetailedDate),
  };
}

function stripBikeWorkoutsAfter(
  week: WeekPlan,
  lastDetailedDate: string,
): WeekPlan {
  const hasStructuredWorkout = week.sessions.some(
    (session) => session.date > lastDetailedDate && session.bikeWorkout != null,
  );
  if (!hasStructuredWorkout) {
    return week;
  }
  return {
    ...week,
    sessions: week.sessions.map((session) =>
      session.date > lastDetailedDate && session.bikeWorkout != null
        ? { ...session, bikeWorkout: null }
        : session,
    ),
  };
}
