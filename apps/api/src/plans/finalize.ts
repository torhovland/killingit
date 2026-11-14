import type {
  AnalyzedActivity,
  CoachPlan,
  DailyWeather,
  DayPlan,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/activityContext.js";
import { applyTrainingLoad } from "../training/load.js";
import type { ThresholdTimeline } from "../training/thresholds.js";
import { applyForecastToPlan } from "../weather/apply.js";
import type { WeatherForecastSet } from "../weather/forecast.js";
import { syncDietProgressTargets } from "./dietProgress.js";
import { outlineWeekPlans } from "./outline.js";
import { blockFor, weekFor } from "./periods.js";
import { assertPlanValid } from "./validate.js";
import { applyCompletedDays, deriveTodayStatus } from "./week.js";

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
