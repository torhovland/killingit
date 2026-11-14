import type {
  BodyMetricEstimate,
  CoachPlan,
  WeekPlan,
} from "@killingit/shared";
import { activityLocalDate } from "@killingit/shared";
import { mergeDietProgressTargets } from "../dietProgress.js";
import {
  mergeNextPeriod,
  mergeSeasonAndBlock,
  mergeTomorrow,
  mergeWeekAndDay,
  type PlanUpdateFlags,
} from "../revision.js";
import type { GeneratePlanInput, PlanGenerationContext } from "./types.js";

/** Applies the levels the update prompt revised and keeps the rest stored. */
export function applyPlanUpdate(
  input: GeneratePlanInput,
  current: CoachPlan,
  update: CoachPlan,
  revision: PlanUpdateFlags,
  options: {
    expectedBlockStartDate?: string;
    nextBlockStartDate?: string;
    nextWeekStartDate?: string;
    reviseBlock?: boolean;
  },
): CoachPlan {
  const { today } = input;
  let plan = mergeSeasonAndBlock(current, update, revision, today);

  if (
    revision.block &&
    options.expectedBlockStartDate !== undefined &&
    plan.block.startDate !== options.expectedBlockStartDate
  ) {
    throw new Error(
      `The coach returned a block with start date ${plan.block.startDate} instead of ${options.expectedBlockStartDate}. Please regenerate the plan.`,
    );
  }

  plan = mergeWeekAndDay(plan, update, revision);
  plan = mergeNextPeriod(plan, update, revision);
  plan = mergeTomorrow(plan, update, revision, today);

  if (revision.week && !revision.day) {
    plan = {
      ...plan,
      week: restoreTodaysSession(plan.week, current, today),
      today: current.today,
    };
  }

  plan = mergeDietProgressTargets(plan, update);

  return {
    ...plan,
    diet: update.diet ?? plan.diet,
    bodyMetrics: mergeBodyMetrics(current.bodyMetrics, update.bodyMetrics),
  };
}

/**
 * Keeps the stored session for today while the rest of the week is revised.
 * Used when the athlete's new input describes today's session, so the coach
 * cannot propose a second workout for the same day. When an activity has
 * already been recorded today, the caller skips this so the completed session
 * can be refreshed from the latest comment instead.
 */
export function restoreTodaysSession(
  week: WeekPlan,
  current: CoachPlan,
  today: string,
): WeekPlan {
  const existing = current.week.sessions.find(
    (session) => session.date === today,
  );
  if (!existing) {
    return week;
  }
  return {
    ...week,
    sessions: week.sessions.map((session) =>
      session.date === today ? existing : session,
    ),
  };
}

/** True when a synced or manually recorded activity happened on `date`. */
export function hasActivityOn(
  context: PlanGenerationContext,
  date: string,
): boolean {
  return (
    context.activities.some(
      (activity) => activityLocalDate(activity, context.timeZone) === date,
    ) ||
    // A manual entry already stores the athlete's chosen date.
    context.manualActivities.some((activity) => activity.startDate === date)
  );
}

/**
 * Combines the body-composition points from several coach responses into one
 * point per date, oldest first. A point with neither value is dropped.
 */
export function mergeBodyMetrics(
  ...sources: readonly (readonly BodyMetricEstimate[] | undefined)[]
): BodyMetricEstimate[] {
  const byDate = new Map<string, BodyMetricEstimate>();
  for (const source of sources) {
    for (const point of source ?? []) {
      if (point.weightKg === null && point.bodyFatPercent === null) {
        continue;
      }
      byDate.set(point.date, point);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
