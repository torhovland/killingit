import {
  MIN_PLAUSIBLE_CALORIES_KCAL,
  plannedCaloriesKcal,
  type CalorieBreakdown,
  type CoachPlan,
  type WeekPlan,
} from "@killingit/shared";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { planDayCalories } from "../db/schema.js";

/** The writer the plan store passes in so this joins its transaction. */
type DayCaloriesWriter = Pick<typeof db, "insert">;

/** One day's estimated calorie requirement, keyed by its date. */
export type PlanDayCalories = ReadonlyMap<string, number>;

/** One day's calorie requirement and the coach's breakdown of it. */
export interface PlanDayCalorieTarget {
  /** The allocated intake: the breakdown's sum, or an older whole-day total. */
  caloriesKcal: number;
  /** The breakdown when the plan stored one; null for older targets. */
  calorieBreakdown: CalorieBreakdown | null;
}

/** Every stored daily target in a window, keyed by date. */
export type PlanDayCalorieTargets = ReadonlyMap<string, PlanDayCalorieTarget>;

/** The fields a plan level needs to contribute a calorie target. */
interface CalorieDay {
  date: string;
  estimatedCaloriesKcal?: number | undefined;
  calorieBreakdown?: CalorieBreakdown | null | undefined;
}

function addDay(
  target: Map<string, PlanDayCalorieTarget>,
  day: CalorieDay,
): void {
  const calories = plannedCaloriesKcal(day);
  if (calories === null) {
    return;
  }
  target.set(day.date, {
    caloriesKcal: Math.round(calories),
    calorieBreakdown: day.calorieBreakdown ?? null,
  });
}

function addWeek(
  target: Map<string, PlanDayCalorieTarget>,
  week: WeekPlan | null,
): void {
  if (week === null) {
    return;
  }
  for (const session of week.sessions) {
    addDay(target, session);
  }
}

/**
 * Every calorie estimate the stored plan carries, keyed by date. The detailed
 * day objects win over the week outline for the same date, because the day is
 * the coach's final prescription.
 */
export function dayCaloriesForPlan(
  plan: CoachPlan,
): Map<string, PlanDayCalorieTarget> {
  const calories = new Map<string, PlanDayCalorieTarget>();
  addWeek(calories, plan.week);
  addWeek(calories, plan.nextWeek);
  addDay(calories, plan.today);
  if (plan.tomorrow !== null) {
    addDay(calories, plan.tomorrow);
  }
  return calories;
}

/**
 * Writes the calorie estimates of the days the plan covers, keeping the record
 * of past days after the coach has moved on. Called whenever a plan is saved,
 * inside the same transaction when the save is fenced.
 */
export async function recordPlanDayCalories(
  userId: number,
  plan: CoachPlan,
  writer: DayCaloriesWriter = db,
): Promise<void> {
  const now = new Date();
  for (const [date, target] of dayCaloriesForPlan(plan)) {
    const { caloriesKcal, calorieBreakdown } = target;
    await writer
      .insert(planDayCalories)
      .values({
        userId,
        date,
        caloriesKcal,
        basalMetabolismKcal: calorieBreakdown?.basalMetabolismKcal ?? null,
        workoutCaloriesKcal: calorieBreakdown?.workoutCaloriesKcal ?? null,
        dietDeficitKcal: calorieBreakdown?.dietDeficitKcal ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [planDayCalories.userId, planDayCalories.date],
        set: {
          caloriesKcal,
          basalMetabolismKcal: calorieBreakdown?.basalMetabolismKcal ?? null,
          workoutCaloriesKcal: calorieBreakdown?.workoutCaloriesKcal ?? null,
          dietDeficitKcal: calorieBreakdown?.dietDeficitKcal ?? null,
          updatedAt: now,
        },
      });
  }
}

/**
 * Loads the stored calorie targets between two dates, inclusive, including the
 * coach's breakdown when the plan stored one. The Fitness and prompt readers
 * only need the total, which `loadPlanDayCalories` returns.
 */
export async function loadPlanDayCalorieTargets(
  userId: number,
  fromDate: string,
  toDate: string,
): Promise<Map<string, PlanDayCalorieTarget>> {
  const rows = await db
    .select({
      date: planDayCalories.date,
      caloriesKcal: planDayCalories.caloriesKcal,
      basalMetabolismKcal: planDayCalories.basalMetabolismKcal,
      workoutCaloriesKcal: planDayCalories.workoutCaloriesKcal,
      dietDeficitKcal: planDayCalories.dietDeficitKcal,
    })
    .from(planDayCalories)
    .where(
      and(
        eq(planDayCalories.userId, userId),
        gte(planDayCalories.date, fromDate),
        lte(planDayCalories.date, toDate),
        gte(planDayCalories.caloriesKcal, MIN_PLAUSIBLE_CALORIES_KCAL),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.date,
      {
        caloriesKcal: row.caloriesKcal,
        calorieBreakdown:
          row.basalMetabolismKcal !== null &&
          row.workoutCaloriesKcal !== null &&
          row.dietDeficitKcal !== null
            ? {
                basalMetabolismKcal: row.basalMetabolismKcal,
                workoutCaloriesKcal: row.workoutCaloriesKcal,
                dietDeficitKcal: row.dietDeficitKcal,
              }
            : null,
      },
    ]),
  );
}

/** Loads the stored calorie totals between two dates, inclusive. */
export async function loadPlanDayCalories(
  userId: number,
  fromDate: string,
  toDate: string,
): Promise<PlanDayCalories> {
  const targets = await loadPlanDayCalorieTargets(userId, fromDate, toDate);
  return new Map(
    [...targets].map(([date, target]) => [date, target.caloriesKcal]),
  );
}
