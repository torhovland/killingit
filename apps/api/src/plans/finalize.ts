import type {
  AnalyzedActivity,
  CoachPlan,
  DailyWeather,
  DayPlan,
} from "@killingit/shared";
import { addDays, startOfWeek } from "@killingit/shared";
import type { ManualActivityContext } from "../llm/activityContext.js";
import { applyTrainingLoad } from "../training/load.js";
import type { ThresholdTimeline } from "../training/thresholds.js";
import { applyForecastToPlan } from "../weather/apply.js";
import type { WeatherForecastSet } from "../weather/forecast.js";
import { calorieEstimateProblems } from "./calorieEstimates.js";
import { syncDietProgressTargets } from "./dietProgress.js";
import { outlineWeekPlans } from "./outline.js";
import { blockFor, weekFor } from "./periods.js";
import {
  applyCompletedDays,
  activitiesOnDate,
  todayCompletionStatus,
} from "./week.js";

/**
 * Every step of the plan finalisation pipeline, in the order it runs.
 * `finalizePlan` iterates this list, so the declared order is the executed
 * order. See `docs/specs/plan-finalisation.md`.
 */
export const FINALIZE_PLAN_STEPS = [
  "settleToday",
  "settleCompletedDays",
  "outlineWeeks",
  "dropUnplacedTomorrow",
  "attachForecast",
  "syncDietProgress",
  "applyTrainingLoad",
  "validatePlan",
] as const;

export type FinalizePlanStep = (typeof FINALIZE_PLAN_STEPS)[number];

/** Which pipeline steps a path runs. */
export type FinalizePlanSteps = Readonly<Record<FinalizePlanStep, boolean>>;

/**
 * Only the steps that settle recorded data onto a plan: today's completion and
 * the completed days. A path that revises the plan again before it is saved
 * settles first, so the follow-up completion sees the plan as it stands.
 */
export const SETTLEMENT_FINALISATION: FinalizePlanSteps = {
  settleToday: true,
  settleCompletedDays: true,
  outlineWeeks: false,
  dropUnplacedTomorrow: false,
  attachForecast: false,
  syncDietProgress: false,
  applyTrainingLoad: false,
  validatePlan: false,
};

/**
 * The full pipeline, for every path that saves a plan the coach has just
 * written: a fresh build and every plan update.
 */
export const COACH_PLAN_FINALISATION: FinalizePlanSteps = {
  ...SETTLEMENT_FINALISATION,
  outlineWeeks: true,
  dropUnplacedTomorrow: true,
  attachForecast: true,
  syncDietProgress: true,
  applyTrainingLoad: true,
  validatePlan: true,
};

/**
 * The pipeline for storing a stored plan again without a coach completion. It
 * keeps the stored training content, so it skips the steps only a new coach
 * response needs: the week is not re-outlined, the stored weather is not
 * replaced by today's forecast, no diet target is re-synced because no coach
 * wrote one, and a plan that was validated when it was written is not
 * re-validated (a stored plan must not fail a run that changed nothing).
 */
export const STORED_PLAN_FINALISATION: FinalizePlanSteps = {
  ...SETTLEMENT_FINALISATION,
  dropUnplacedTomorrow: true,
  applyTrainingLoad: true,
};

/** Everything the pipeline reads from the athlete's stored data. */
export interface FinalizePlanInput {
  /** The day the plan is finalised for. */
  today: string;
  /** Whether this run wants tomorrow's session, which decides if it is dropped. */
  includeTomorrow: boolean;
  /**
   * The session today's completion is judged against; defaults to the plan's
   * own today. A run that revised today passes the stored session, so the
   * verdict compares the recorded activity with what the athlete was asked to
   * do rather than with a freshly proposed session.
   */
  plannedToday?: DayPlan;
  activities: readonly AnalyzedActivity[];
  manualActivities: readonly ManualActivityContext[];
  timeZone?: string | null | undefined;
  thresholdTimelines?: readonly ThresholdTimeline[] | undefined;
  /** Both provider forecasts and their combined average, attached to sessions. */
  weatherForecasts?: WeatherForecastSet | null;
  /** The combined forecast, used when only it is known. */
  forecast?: readonly DailyWeather[] | null;
}

/**
 * Settles and post-processes a plan in one fixed order, so a fresh build, an
 * update and a stored-plan re-save cannot save different plans for the same
 * input. The order matters: today's verdict comes before the week that repeats
 * it, the outline comes before the load that scores it, a dropped tomorrow
 * never gets a forecast, the diet copy reads the levels that are about to be
 * saved, and validation describes the finished plan.
 */
export function finalizePlan(
  plan: CoachPlan,
  input: FinalizePlanInput,
  steps: FinalizePlanSteps,
): CoachPlan {
  let finalized = plan;
  for (const step of FINALIZE_PLAN_STEPS) {
    if (steps[step]) {
      finalized = FINALIZE_PLAN_STEP_RUNNERS[step](finalized, input);
    }
  }
  return finalized;
}

const FINALIZE_PLAN_STEP_RUNNERS: Readonly<
  Record<
    FinalizePlanStep,
    (plan: CoachPlan, input: FinalizePlanInput) => CoachPlan
  >
> = {
  settleToday: (plan, input) => settleToday(plan, input),
  settleCompletedDays: (plan, input) => settleCompletedDays(plan, input),
  outlineWeeks: (plan) => outlineWeekPlans(plan),
  dropUnplacedTomorrow: (plan, input) =>
    dropUnplacedTomorrow(plan, input.includeTomorrow),
  attachForecast: (plan, input) =>
    applyForecastToPlan(plan, forecastForStorage(input)),
  syncDietProgress: (plan) => syncDietProgressTargets(plan),
  applyTrainingLoad: (plan, input) =>
    applyTrainingLoad(plan, {
      activities: input.activities,
      manualActivities: input.manualActivities,
      thresholdTimelines: input.thresholdTimelines,
      timeZone: input.timeZone,
    }),
  validatePlan: (plan, input) => {
    assertPlanValid(plan, input.today, input.includeTomorrow);
    return plan;
  },
};

/** Settles today's status from what was recorded. */
function settleToday(plan: CoachPlan, input: FinalizePlanInput): CoachPlan {
  return { ...plan, today: deriveTodayStatus(plan.today, input) };
}

/** Settles the week's past and present days from the same recorded data. */
function settleCompletedDays(
  plan: CoachPlan,
  input: FinalizePlanInput,
): CoachPlan {
  return {
    ...plan,
    week: applyCompletedDays(
      plan.week,
      input.activities,
      input.today,
      input.timeZone,
      input.manualActivities,
      plan.today,
    ),
  };
}

/**
 * Settles today's status from what was recorded. The day and the week share one
 * rule in `week.ts`, so both reach the same verdict from the same activities.
 */
function deriveTodayStatus(day: DayPlan, input: FinalizePlanInput): DayPlan {
  if (day.date !== input.today) {
    return day;
  }
  return {
    ...day,
    status: todayCompletionStatus(
      input.plannedToday ?? day,
      activitiesOnDate(
        input.activities,
        input.manualActivities,
        input.timeZone,
        input.today,
      ),
      day.status,
    ),
  };
}

/**
 * A tomorrow session that falls outside both stored weeks and blocks cannot be
 * shown next to a week plan. This happens when a server-triggered revision runs
 * without `includeTomorrow` (for example a comment saved after 18:00); keep the
 * plan valid and let the next visit that asks for tomorrow regenerate it.
 */
function dropUnplacedTomorrow(
  plan: CoachPlan,
  includeTomorrow: boolean,
): CoachPlan {
  if (includeTomorrow || plan.tomorrow === null) {
    return plan;
  }
  const date = plan.tomorrow.date;
  if (weekFor(plan, date) !== null && blockFor(plan, date) !== null) {
    return plan;
  }
  return { ...plan, tomorrow: null };
}

/**
 * Guards against a model that returns a plan for the wrong date. Without this
 * the pending check would immediately ask for another generation and loop.
 * Every write path ends here, so the season's block boundaries are checked
 * here too.
 */
function assertPlanValid(
  plan: CoachPlan,
  today: string,
  includeTomorrow: boolean,
): void {
  const calorieProblem = calorieEstimateProblems(plan)[0];
  if (calorieProblem !== undefined) {
    throw new Error(`${calorieProblem.message} Please regenerate the plan.`);
  }
  assertSeasonBlocksContiguous(plan.season, today);
  if (plan.today.date !== today) {
    throw new Error(
      "The coach returned today's session for the wrong date. Please regenerate the plan.",
    );
  }
  if (!plan.week.sessions.some((session) => session.date === today)) {
    throw new Error(
      "The coach returned a week that does not include today. Please regenerate the plan.",
    );
  }
  if (today < plan.block.startDate || today > plan.block.endDate) {
    throw new Error(
      "The coach returned a block that does not cover today. Please regenerate the plan.",
    );
  }
  if (today < plan.season.startDate || today > plan.season.endDate) {
    throw new Error(
      "The coach returned a season that does not cover today. Please regenerate the plan.",
    );
  }
  if (plan.nextWeek !== null) {
    if (plan.nextWeek.startDate !== startOfWeek(plan.nextWeek.startDate)) {
      throw new Error(
        "The coach returned a week that does not start on a Monday. Please regenerate the plan.",
      );
    }
    if (plan.nextWeek.sessions[0]?.date !== plan.nextWeek.startDate) {
      throw new Error(
        "The coach returned a week whose sessions do not match its start date. Please regenerate the plan.",
      );
    }
    if (plan.nextWeek.startDate <= plan.week.startDate) {
      throw new Error(
        "The coach returned a next week that is not after the current week. Please regenerate the plan.",
      );
    }
    if (
      includeTomorrow &&
      plan.nextWeek.startDate !== startOfWeek(addDays(today, 1))
    ) {
      throw new Error(
        "The coach returned the wrong next week. Please regenerate the plan.",
      );
    }
  }
  if (plan.nextBlock !== null) {
    if (plan.nextBlock.startDate <= plan.block.endDate) {
      throw new Error(
        "The coach returned a next block that does not follow the current block. Please regenerate the plan.",
      );
    }
    if (plan.nextBlock.startDate > plan.nextBlock.endDate) {
      throw new Error(
        "The coach returned a next block with invalid dates. Please regenerate the plan.",
      );
    }
  }
  if (plan.tomorrow !== null) {
    const tomorrowDate = addDays(today, 1);
    if (plan.tomorrow.date !== tomorrowDate) {
      throw new Error(
        "The coach returned tomorrow's session for the wrong date. Please regenerate the plan.",
      );
    }
    const week = weekFor(plan, tomorrowDate);
    if (
      week === null ||
      !week.sessions.some((session) => session.date === tomorrowDate)
    ) {
      throw new Error(
        "The coach returned tomorrow's session outside a planned week. Please regenerate the plan.",
      );
    }
    if (blockFor(plan, tomorrowDate) === null) {
      throw new Error(
        "The coach returned tomorrow's session outside a planned block. Please regenerate the plan.",
      );
    }
  }
}

/**
 * Season blocks tile the season: each block starts the day after the previous
 * one ends. A shared day puts a date in two blocks and a skipped day leaves it
 * in none, so both are rejected on every write — a build, a season refresh and
 * a block, week or day update that returns the season alike. Without this a
 * week or block update could store overlapping blocks that every later season
 * refresh then reproduced. Blocks that ended before today are stored history
 * the coach cannot change, so their boundaries are not re-checked.
 */
function assertSeasonBlocksContiguous(
  season: CoachPlan["season"],
  today: string,
): void {
  const upcoming = season.blocks.filter((entry) => entry.endDate >= today);
  for (let index = 1; index < upcoming.length; index += 1) {
    const previous = upcoming[index - 1];
    const next = upcoming[index];
    if (previous === undefined || next === undefined) {
      continue;
    }
    if (next.startDate <= previous.endDate) {
      throw new Error(
        `The coach returned overlapping season blocks: "${next.name}" starts on ${next.startDate}, the day "${previous.name}" ends. Please regenerate the plan.`,
      );
    }
    const unplanned = addDays(previous.endDate, 1);
    if (next.startDate !== unplanned) {
      throw new Error(
        `The coach returned a gap between season blocks: "${previous.name}" ends on ${previous.endDate} and "${next.name}" starts on ${next.startDate}, leaving ${unplanned} unplanned. Please regenerate the plan.`,
      );
    }
  }
}

/**
 * The full provider set is stored on sessions for display. Older tests and
 * callers may supply only the combined forecast, so use that as a fallback.
 */
function forecastForStorage(
  input: FinalizePlanInput,
): WeatherForecastSet | null {
  if (input.weatherForecasts) {
    return input.weatherForecasts;
  }
  if (!input.forecast || input.forecast.length === 0) {
    return null;
  }
  return {
    openMeteo: [],
    yr: [],
    combined: [...input.forecast],
  };
}
