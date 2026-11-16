import {
  addDays,
  type AnalyzedActivity,
  type CoachPlan,
  type FitnessHistoryResponse,
  type FitnessRange,
} from "@killingit/shared";
import { consumedCaloriesByDate } from "../diet/days.js";
import { dbFoodEntryStore } from "../diet/store.js";
import { loadDailyHealthHistoryForUser } from "../metrics/dailyMetrics.js";
import { loadMetricPoints } from "../metrics/store.js";
import { loadPlanDayCalories } from "../plans/dayCalories.js";
import { loadTrainingContext } from "./context.js";
import {
  buildFitnessHistory,
  plannedEndDate,
  type FitnessHistoryInput,
} from "./fitnessSeries.js";

/** How far back the nutrition chart reads meals and calorie targets. */
const DIET_CHART_LOOKBACK_DAYS = 365;

/**
 * The stores the fitness history reads from. Injected so the page's series can
 * be built without a database; production leaves every field unset.
 */
interface FitnessHistoryDependencies {
  loadTrainingContext?: typeof loadTrainingContext | undefined;
  loadMetricPoints?: typeof loadMetricPoints | undefined;
  loadDailyHealth?: typeof loadDailyHealthHistoryForUser | undefined;
  loadNutrition?: typeof loadNutrition | undefined;
}

/** The athlete, window and injected stores behind one fitness history read. */
export interface FitnessHistoryRequest {
  userId: number;
  /** The cached activities the chart plots. */
  activities: readonly AnalyzedActivity[];
  plan: CoachPlan | undefined;
  /** The athlete's current date; the window ends here unless the plan runs on. */
  today: string;
  range: FitnessRange;
  /** Whether the athlete wants diet advice, so the nutrition chart is read. */
  dietAdvice?: boolean;
  /** The athlete's IANA time zone, so an activity is charted on its local day. */
  timeZone?: string | null;
  /** Overrides for the stores; production leaves every field unset. */
  deps?: FitnessHistoryDependencies;
}

/**
 * Loads the cached activities and stores the fitness history for the page.
 */
export async function loadFitnessHistory(
  request: FitnessHistoryRequest,
): Promise<FitnessHistoryResponse> {
  const { userId, activities, plan, today, range, timeZone } = request;
  const dietAdvice = request.dietAdvice ?? false;
  const deps = request.deps ?? {};
  const [context, weight, bodyFat, dailyHealthPoints, nutrition] =
    await Promise.all([
      (deps.loadTrainingContext ?? loadTrainingContext)(userId, plan, today),
      (deps.loadMetricPoints ?? loadMetricPoints)(userId, "weight"),
      (deps.loadMetricPoints ?? loadMetricPoints)(userId, "body_fat"),
      (deps.loadDailyHealth ?? loadDailyHealthHistoryForUser)(userId, today),
      (deps.loadNutrition ?? loadNutrition)(userId, plan, today, dietAdvice),
    ]);
  return buildFitnessHistory({
    today,
    range,
    timeZone,
    activities,
    plan,
    thresholdTimelines: context.thresholdTimelines,
    thresholdPoints: context.thresholdPoints,
    planTssByDate: context.planTssByDate,
    manualTssByDate: context.manualTssByDate,
    manualActivities: context.manualActivities,
    bodyPoints: { weight, bodyFat },
    dailyHealthPoints,
    ...(nutrition != null ? { nutrition } : {}),
    dietAdvice,
  });
}

/** The food and calorie-target data behind the fitness chart. */
async function loadNutrition(
  userId: number,
  plan: CoachPlan | undefined,
  today: string,
  dietAdvice: boolean,
): Promise<FitnessHistoryInput["nutrition"] | null> {
  if (!dietAdvice) {
    return null;
  }
  try {
    const from = addDays(today, -DIET_CHART_LOOKBACK_DAYS);
    const to = plannedEndDate(plan) ?? today;
    const [entries, needed] = await Promise.all([
      dbFoodEntryStore.listSince(userId, from),
      loadPlanDayCalories(userId, from, to),
    ]);
    return { consumed: consumedCaloriesByDate(entries), needed };
  } catch (err) {
    console.error("[fitness] could not read the nutrition history:", err);
    return null;
  }
}
