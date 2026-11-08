import {
  allocatedCaloriesKcal,
  MIN_PLAUSIBLE_CALORIES_KCAL,
  type CalorieBreakdown,
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

/** One implausible or incomplete calorie estimate with its JSON path. */
export interface CalorieEstimateProblem {
  path: (string | number)[];
  message: string;
}

/** How strictly a generated plan is checked for the calorie breakdown. */
export interface CalorieEstimateOptions {
  /**
   * Whether every level that carries a calorie estimate must also carry its
   * breakdown. Generated plans are held to this; stored plans from before the
   * breakdown existed are not.
   */
  requireBreakdown?: boolean;
}

/** The calorie-bearing fields of a week session or day plan. */
interface CalorieEstimateValue {
  estimatedCaloriesKcal?: number | undefined;
  calorieBreakdown?: CalorieBreakdown | null | undefined;
}

function estimateProblem(
  date: string,
  value: CalorieEstimateValue,
  path: (string | number)[],
  options: CalorieEstimateOptions,
): CalorieEstimateProblem | null {
  if (value.calorieBreakdown == null) {
    const estimated = value.estimatedCaloriesKcal;
    if (estimated === undefined) {
      return null;
    }
    if (options.requireBreakdown === true) {
      return {
        path: [...path, "calorieBreakdown"],
        message: `The calorie estimate for ${date} has no breakdown. Return "calorieBreakdown" with "basalMetabolismKcal", "workoutCaloriesKcal" and "dietDeficitKcal", and make "estimatedCaloriesKcal" equal base metabolism plus the workout requirement minus the deficit.`,
      };
    }
    return totalProblem(date, estimated, [...path, "estimatedCaloriesKcal"]);
  }
  return totalProblem(date, allocatedCaloriesKcal(value.calorieBreakdown), [
    ...path,
    "calorieBreakdown",
  ]);
}

function totalProblem(
  date: string,
  total: number,
  path: (string | number)[],
): CalorieEstimateProblem | null {
  if (total >= MIN_PLAUSIBLE_CALORIES_KCAL) {
    return null;
  }
  return {
    path,
    message: `The allocated calorie target for ${date} is ${Math.round(total)} kcal, which is below the ${MIN_PLAUSIBLE_CALORIES_KCAL} kcal safety minimum. Return the whole day's allocated intake, not a deficit, a surplus, or the calories burned in training.`,
  };
}

function weekProblems(
  week: WeekPlan | null | undefined,
  key: "week" | "nextWeek",
  options: CalorieEstimateOptions,
): CalorieEstimateProblem[] {
  if (week === null || week === undefined) {
    return [];
  }
  return week.sessions.flatMap((session, index) => {
    const found = estimateProblem(
      session.date,
      session,
      [key, "sessions", index],
      options,
    );
    return found === null ? [] : [found];
  });
}

function dayProblems(
  day: DayPlan | null | undefined,
  key: "today" | "tomorrow",
  options: CalorieEstimateOptions,
): CalorieEstimateProblem[] {
  if (day === null || day === undefined) {
    return [];
  }
  const found = estimateProblem(day.date, day, [key], options);
  return found === null ? [] : [found];
}

/**
 * Every calorie target in a plan that is too low to be a whole day's intake,
 * plus a missing breakdown when a generated plan is being checked. The sum of
 * the breakdown is the allocated intake, so a model that returns a deficit or
 * the calories burned in a session is caught here before the plan is stored.
 */
export function calorieEstimateProblems(
  plan: CalorieBearingPlan,
  options: CalorieEstimateOptions = {},
): CalorieEstimateProblem[] {
  return [
    ...weekProblems(plan.week, "week", options),
    ...weekProblems(plan.nextWeek, "nextWeek", options),
    ...dayProblems(plan.today, "today", options),
    ...dayProblems(plan.tomorrow, "tomorrow", options),
  ];
}

/** Adds every implausible calorie estimate to a Zod refinement context. */
export function addCalorieEstimateIssues(
  plan: CalorieBearingPlan,
  ctx: RefinementCtx,
  options: CalorieEstimateOptions = {},
): void {
  for (const issue of calorieEstimateProblems(plan, options)) {
    ctx.addIssue({
      code: "custom",
      message: issue.message,
      path: issue.path,
    });
  }
}
