import {
  MIN_PLAUSIBLE_CALORIES_KCAL,
  plausibleCaloriesKcal,
  type DayPlan,
  type WeekPlan,
} from "@killingit/shared";
import type { RefinementCtx } from "zod";

/** The plan levels that can carry a daily calorie estimate. */
export interface CalorieBearingPlan {
  week?: WeekPlan | undefined;
  nextWeek?: WeekPlan | null | undefined;
  today?: DayPlan | null | undefined;
  tomorrow?: DayPlan | null | undefined;
}

/** One implausible calorie estimate with the JSON path that holds it. */
export interface CalorieEstimateProblem {
  path: (string | number)[];
  message: string;
}

function problem(
  date: string,
  value: number | undefined,
  path: (string | number)[],
): CalorieEstimateProblem | null {
  if (value === undefined || plausibleCaloriesKcal(value) !== null) {
    return null;
  }
  return {
    path,
    message: `The total daily calorie target for ${date} is ${Math.round(value)} kcal, which is below the ${MIN_PLAUSIBLE_CALORIES_KCAL} kcal safety minimum. Return the whole day's total intake, not a deficit, a surplus, or the calories burned in training.`,
  };
}

function weekProblems(
  week: WeekPlan | null | undefined,
  key: "week" | "nextWeek",
): CalorieEstimateProblem[] {
  if (week === null || week === undefined) {
    return [];
  }
  return week.sessions.flatMap((session, index) => {
    const found = problem(session.date, session.estimatedCaloriesKcal, [
      key,
      "sessions",
      index,
      "estimatedCaloriesKcal",
    ]);
    return found === null ? [] : [found];
  });
}

function dayProblems(
  day: DayPlan | null | undefined,
  key: "today" | "tomorrow",
): CalorieEstimateProblem[] {
  if (day === null || day === undefined) {
    return [];
  }
  const found = problem(day.date, day.estimatedCaloriesKcal, [
    key,
    "estimatedCaloriesKcal",
  ]);
  return found === null ? [] : [found];
}

/**
 * Every calorie target in a generated plan that is too low to be a whole day's
 * intake. A model that returns a deficit or the calories burned in a session
 * instead of the day's requirement is caught here before the plan is stored.
 */
export function calorieEstimateProblems(
  plan: CalorieBearingPlan,
): CalorieEstimateProblem[] {
  return [
    ...weekProblems(plan.week, "week"),
    ...weekProblems(plan.nextWeek, "nextWeek"),
    ...dayProblems(plan.today, "today"),
    ...dayProblems(plan.tomorrow, "tomorrow"),
  ];
}

/** Adds every implausible calorie estimate to a Zod refinement context. */
export function addCalorieEstimateIssues(
  plan: CalorieBearingPlan,
  ctx: RefinementCtx,
): void {
  for (const issue of calorieEstimateProblems(plan)) {
    ctx.addIssue({
      code: "custom",
      message: issue.message,
      path: issue.path,
    });
  }
}
