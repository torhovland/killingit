import type { CoachPlan, WeekPlan } from "@killingit/shared";

/**
 * Enforces the week-outline contract: no week plan carries a structured trainer
 * workout. The concrete prescription lives in the today and tomorrow day
 * objects; every session in the current and next week is an overview.
 */
export function outlineWeekPlans(plan: CoachPlan): CoachPlan {
  return {
    ...plan,
    week: stripBikeWorkouts(plan.week),
    nextWeek: plan.nextWeek === null ? null : stripBikeWorkouts(plan.nextWeek),
  };
}

function stripBikeWorkouts(week: WeekPlan): WeekPlan {
  const hasStructuredWorkout = week.sessions.some(
    (session) => session.bikeWorkout != null,
  );
  if (!hasStructuredWorkout) {
    return week;
  }
  return {
    ...week,
    sessions: week.sessions.map((session) =>
      session.bikeWorkout != null ? { ...session, bikeWorkout: null } : session,
    ),
  };
}
