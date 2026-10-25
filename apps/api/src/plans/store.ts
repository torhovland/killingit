import type { CoachPlan, PlanGenerationStatus } from "@killingit/shared";
import { and, eq, lt, ne, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  coachPlans,
  planGenerations,
  type CoachPlanRow,
  type PlanGenerationRow,
} from "../db/schema.js";
import { STALE_GENERATION_MS } from "./generation.js";

/** A persisted plan plus the answer timestamp it was generated from. */
export interface StoredPlan {
  plan: CoachPlan;
  answersUpdatedAt: Date | null;
  coachingInputsUpdatedAt: Date | null;
  /** Newest activity analysis included in this plan. */
  activitiesUpdatedAt: Date | null;
  generatedAt: Date;
}

export interface PlanStore {
  load(userId: number): Promise<StoredPlan | null>;
  save(
    userId: number,
    plan: CoachPlan,
    answersUpdatedAt: Date | null,
    coachingInputsUpdatedAt: Date | null,
    activitiesUpdatedAt: Date | null,
  ): Promise<StoredPlan>;
}

export interface PlanGenerationStore {
  load(userId: number): Promise<PlanGenerationStatus>;
  /** Marks a run as running. Returns false when one is already in progress. */
  begin(userId: number): Promise<boolean>;
  update(userId: number, step: string, progress: number): Promise<void>;
  /** Refreshes a running run so a dead process can be detected. */
  heartbeat(userId: number): Promise<void>;
  finish(userId: number): Promise<void>;
  fail(userId: number, error: string): Promise<void>;
}

/** The status returned before the first generation has ever run. */
export function idleGenerationStatus(): PlanGenerationStatus {
  return {
    status: "idle",
    step: null,
    progress: 0,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

function toStoredPlan(row: CoachPlanRow): StoredPlan {
  return {
    plan: {
      season: row.season,
      block: row.block,
      week: row.week,
      today: row.today,
      tomorrow: row.tomorrow,
      nextWeek: row.nextWeek,
      nextBlock: row.nextBlock,
    },
    answersUpdatedAt: row.answersUpdatedAt,
    coachingInputsUpdatedAt: row.coachingInputsUpdatedAt,
    activitiesUpdatedAt: row.activitiesUpdatedAt,
    generatedAt: row.generatedAt,
  };
}

function toGenerationStatus(row: PlanGenerationRow): PlanGenerationStatus {
  return {
    status: row.status,
    step: row.step,
    progress: row.progress,
    error: row.error,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** PostgreSQL-backed plan store. One row per user, replaced on regeneration. */
export const dbPlanStore: PlanStore = {
  async load(userId) {
    const rows = await db
      .select()
      .from(coachPlans)
      .where(eq(coachPlans.userId, userId))
      .limit(1);
    const row = rows[0];
    return row ? toStoredPlan(row) : null;
  },

  async save(
    userId,
    plan,
    answersUpdatedAt,
    coachingInputsUpdatedAt,
    activitiesUpdatedAt,
  ) {
    const now = new Date();
    const planValues = {
      season: plan.season,
      block: plan.block,
      week: plan.week,
      today: plan.today,
      tomorrow: plan.tomorrow,
      nextWeek: plan.nextWeek,
      nextBlock: plan.nextBlock,
      dayDate: plan.today.date,
      weekStartDate: plan.week.startDate,
      blockStartDate: plan.block.startDate,
      blockEndDate: plan.block.endDate,
      seasonStartDate: plan.season.startDate,
      seasonEndDate: plan.season.endDate,
      answersUpdatedAt,
      coachingInputsUpdatedAt,
      activitiesUpdatedAt,
      generatedAt: now,
      updatedAt: now,
    };

    const [row] = await db
      .insert(coachPlans)
      .values({ userId, ...planValues })
      .onConflictDoUpdate({
        target: coachPlans.userId,
        set: planValues,
      })
      .returning();
    if (!row) {
      throw new Error("failed to persist the coach plan");
    }
    return toStoredPlan(row);
  },
};

/** PostgreSQL-backed generation status store. */
export const dbPlanGenerationStore: PlanGenerationStore = {
  async load(userId) {
    const rows = await db
      .select()
      .from(planGenerations)
      .where(eq(planGenerations.userId, userId))
      .limit(1);
    const row = rows[0];
    return row ? toGenerationStatus(row) : idleGenerationStatus();
  },

  async begin(userId) {
    // Create the row on first use; the unique user index makes this safe.
    await db
      .insert(planGenerations)
      .values({ userId })
      .onConflictDoNothing({ target: planGenerations.userId });

    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_GENERATION_MS);
    const [row] = await db
      .update(planGenerations)
      .set({
        status: "running",
        step: "Preparing your plan",
        progress: 5,
        error: null,
        startedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(planGenerations.userId, userId),
          or(
            ne(planGenerations.status, "running"),
            lt(planGenerations.updatedAt, staleBefore),
          ),
        ),
      )
      .returning({ id: planGenerations.id });

    return row !== undefined;
  },

  async update(userId, step, progress) {
    await db
      .update(planGenerations)
      .set({ step, progress, updatedAt: new Date() })
      .where(eq(planGenerations.userId, userId));
  },

  async heartbeat(userId) {
    await db
      .update(planGenerations)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(planGenerations.userId, userId),
          eq(planGenerations.status, "running"),
        ),
      );
  },

  async finish(userId) {
    await db
      .update(planGenerations)
      .set({
        status: "done",
        step: "Your plan is ready",
        progress: 100,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(planGenerations.userId, userId));
  },

  async fail(userId, error) {
    await db
      .update(planGenerations)
      .set({
        status: "error",
        step: "The coach could not finish your plan",
        error,
        updatedAt: new Date(),
      })
      .where(eq(planGenerations.userId, userId));
  },
};
