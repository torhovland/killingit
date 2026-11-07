import type { CoachPlan, DayPlan, WeekPlan } from "@killingit/shared";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { planDayCalories } from "../db/schema.js";

/** The writer the plan store passes in so this joins its transaction. */
type DayCaloriesWriter = Pick<typeof db, "insert">;

/** One day's estimated calorie requirement, keyed by its date. */
export type PlanDayCalories = ReadonlyMap<string, number>;

function addDay(
  target: Map<string, number>,
  day: Pick<DayPlan, "date" | "estimatedCaloriesKcal">,
): void {
  const calories = day.estimatedCaloriesKcal;
  if (calories === undefined || calories <= 0) {
    return;
  }
  target.set(day.date, Math.round(calories));
}

function addWeek(target: Map<string, number>, week: WeekPlan | null): void {
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
export function dayCaloriesForPlan(plan: CoachPlan): Map<string, number> {
  const calories = new Map<string, number>();
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
  for (const [date, caloriesKcal] of dayCaloriesForPlan(plan)) {
    await writer
      .insert(planDayCalories)
      .values({
        userId,
        date,
        caloriesKcal,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [planDayCalories.userId, planDayCalories.date],
        set: { caloriesKcal, updatedAt: now },
      });
  }
}

/** Loads the stored calorie estimates between two dates, inclusive. */
export async function loadPlanDayCalories(
  userId: number,
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      date: planDayCalories.date,
      caloriesKcal: planDayCalories.caloriesKcal,
    })
    .from(planDayCalories)
    .where(
      and(
        eq(planDayCalories.userId, userId),
        gte(planDayCalories.date, fromDate),
        lte(planDayCalories.date, toDate),
      ),
    );
  return new Map(rows.map((row) => [row.date, row.caloriesKcal]));
}
