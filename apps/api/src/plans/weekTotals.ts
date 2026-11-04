import type { CoachPlan } from "@killingit/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { planWeekTotals } from "../db/schema.js";

/** The planned totals for one Monday-start week. */
export interface WeekPlanTotals {
  plannedMinutes: number;
  plannedTss: number;
}

/** One week's planned totals with the Monday that starts it. */
export interface PlanWeekTotalsEntry extends WeekPlanTotals {
  weekStartDate: string;
}

/** The writer the plan store passes in so this joins its transaction. */
type WeekTotalsWriter = Pick<typeof db, "insert">;

/**
 * The planned time and TSS of the weeks the plan details, current and next.
 * Only workouts count: a rest day adds no time or load.
 */
export function weekTotalsForPlan(plan: CoachPlan): PlanWeekTotalsEntry[] {
  const entries: PlanWeekTotalsEntry[] = [];
  for (const week of [plan.week, plan.nextWeek]) {
    if (week === null) {
      continue;
    }
    const sessions = week.sessions.filter(
      (session) => session.type === "workout",
    );
    entries.push({
      weekStartDate: week.startDate,
      plannedMinutes: sessions.reduce(
        (total, session) => total + session.durationMinutes,
        0,
      ),
      plannedTss: Math.round(
        sessions.reduce(
          (total, session) =>
            total + (session.estimatedTss ?? session.trainingLoad?.tss ?? 0),
          0,
        ),
      ),
    });
  }
  return entries;
}

/**
 * Writes the planned totals of the weeks the plan details, keeping the record
 * of a completed week after the coach has moved on to the next one. Called
 * whenever a plan is saved, inside the same transaction when the save is fenced.
 */
export async function recordPlanWeekTotals(
  userId: number,
  plan: CoachPlan,
  writer: WeekTotalsWriter = db,
): Promise<void> {
  const now = new Date();
  for (const entry of weekTotalsForPlan(plan)) {
    await writer
      .insert(planWeekTotals)
      .values({
        userId,
        weekStartDate: entry.weekStartDate,
        plannedMinutes: entry.plannedMinutes,
        plannedTss: entry.plannedTss,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [planWeekTotals.userId, planWeekTotals.weekStartDate],
        set: {
          plannedMinutes: entry.plannedMinutes,
          plannedTss: entry.plannedTss,
          updatedAt: now,
        },
      });
  }
}

/** Loads every stored week total for the account, keyed by the week's Monday. */
export async function loadPlanWeekTotals(
  userId: number,
): Promise<Map<string, WeekPlanTotals>> {
  const rows = await db
    .select()
    .from(planWeekTotals)
    .where(eq(planWeekTotals.userId, userId));
  return new Map(
    rows.map((row) => [
      row.weekStartDate,
      { plannedMinutes: row.plannedMinutes, plannedTss: row.plannedTss },
    ]),
  );
}
