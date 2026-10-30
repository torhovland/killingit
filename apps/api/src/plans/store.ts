import type { CoachPlan, PlanGenerationStatus } from "@killingit/shared";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  coachPlans,
  planGenerationStepDurations,
  planGenerations,
  type CoachPlanRow,
  type PlanGenerationRow,
} from "../db/schema.js";
import { progressAt, recordDuration } from "./progress.js";
import {
  PLAN_GENERATION_START,
  PLAN_GENERATION_STEPS,
  type PlanGenerationStep,
} from "./steps.js";

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
    /** When supplied, the plan is written only while this run owns the row. */
    runId?: string,
  ): Promise<StoredPlan | null>;
}

export interface PlanGenerationStore {
  load(userId: number): Promise<PlanGenerationStatus>;
  /**
   * Marks a new run as the owner of the row. Starting a run supersedes the
   * previous one, so this always claims the row.
   */
  begin(userId: number, runId: string): Promise<void>;
  /** True while `runId` still owns the generation row. */
  isCurrent(userId: number, runId: string): Promise<boolean>;
  update(
    userId: number,
    step: PlanGenerationStep,
    runId: string,
  ): Promise<void>;
  /** Refreshes a running run so a dead process can be detected. */
  heartbeat(userId: number, runId: string): Promise<void>;
  /** Marks the run done, only when it still owns the row. */
  finish(userId: number, runId: string): Promise<void>;
  /**
   * Marks a running generation as failed and returns the start of the run it
   * cleared, or null when it no longer owns the row.
   */
  fail(
    userId: number,
    error: string,
    runId: string | null,
  ): Promise<Date | null>;
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

/**
 * The percentage to report for a row. While a step runs, its percentage moves
 * from the value reached at the start of the step towards the step's target
 * over its expected duration. Finished, failed, and idle rows are reported as
 * stored.
 */
function reportedProgress(row: PlanGenerationRow, now: number): number {
  if (row.status !== "running" || row.stepStartedAt === null) {
    return row.progress;
  }
  return progressAt(
    row.progress,
    row.progressEnd,
    now - row.stepStartedAt.getTime(),
    row.stepExpectedMs,
  );
}

function toGenerationStatus(
  row: PlanGenerationRow,
  now: number,
): PlanGenerationStatus {
  return {
    status: row.status,
    step: row.step,
    progress: reportedProgress(row, now),
    error: row.error,
    runId: row.runId,
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
    runId,
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

    type PlanWriter = Pick<typeof db, "insert">;
    const write = async (executor: PlanWriter) => {
      const [row] = await executor
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
    };

    if (runId === undefined) {
      return write(db);
    }

    // Lock the generation row, then verify this run still owns it before
    // writing. A superseded run can finish its provider call at any moment;
    // this transaction makes the late result a no-op instead of a stale save.
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({ runId: planGenerations.runId })
        .from(planGenerations)
        .where(eq(planGenerations.userId, userId))
        .for("update");
      if (rows[0]?.runId !== runId) {
        return null;
      }
      return write(tx);
    });
  },
};

/** The learned duration for a step, or its cold-start default. */
async function expectedDurationMs(step: PlanGenerationStep): Promise<number> {
  const rows = await db
    .select({ averageMs: planGenerationStepDurations.averageMs })
    .from(planGenerationStepDurations)
    .where(eq(planGenerationStepDurations.stepId, step.id))
    .limit(1);
  return rows[0]?.averageMs ?? step.defaultMs;
}

async function loadGenerationRow(
  userId: number,
): Promise<PlanGenerationRow | null> {
  const rows = await db
    .select()
    .from(planGenerations)
    .where(eq(planGenerations.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Adds the time the row's current step took to its learned average. Called when
 * the step ends, so a failed or abandoned run does not skew the estimate.
 */
async function learnDuration(row: PlanGenerationRow, now: Date): Promise<void> {
  if (row.stepId === null || row.stepStartedAt === null) {
    return;
  }
  const rows = await db
    .select({
      averageMs: planGenerationStepDurations.averageMs,
      samples: planGenerationStepDurations.samples,
    })
    .from(planGenerationStepDurations)
    .where(eq(planGenerationStepDurations.stepId, row.stepId))
    .limit(1);
  const next = recordDuration(
    rows[0] ?? null,
    now.getTime() - row.stepStartedAt.getTime(),
  );
  await db
    .insert(planGenerationStepDurations)
    .values({ stepId: row.stepId, ...next, updatedAt: now })
    .onConflictDoUpdate({
      target: planGenerationStepDurations.stepId,
      set: { ...next, updatedAt: now },
    });
}

/** PostgreSQL-backed generation status store. */
export const dbPlanGenerationStore: PlanGenerationStore = {
  async load(userId) {
    const row = await loadGenerationRow(userId);
    return row ? toGenerationStatus(row, Date.now()) : idleGenerationStatus();
  },

  async begin(userId, runId) {
    // Create the row on first use; the unique user index makes this safe.
    await db
      .insert(planGenerations)
      .values({ userId })
      .onConflictDoNothing({ target: planGenerations.userId });

    const now = new Date();
    const expectedMs = await expectedDurationMs(PLAN_GENERATION_STEPS.prepare);
    // The newest run always claims the row. The previous run notices the
    // changed run id at its next fence and stops without writing.
    await db
      .update(planGenerations)
      .set({
        status: "running",
        runId,
        step: PLAN_GENERATION_STEPS.prepare.label,
        stepId: PLAN_GENERATION_STEPS.prepare.id,
        progress: PLAN_GENERATION_START,
        progressEnd: PLAN_GENERATION_STEPS.prepare.target,
        stepStartedAt: now,
        stepExpectedMs: expectedMs,
        error: null,
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(planGenerations.userId, userId));
  },

  async isCurrent(userId, runId) {
    const row = await loadGenerationRow(userId);
    return row?.runId === runId && row.status === "running";
  },

  async update(userId, step, runId) {
    const now = new Date();
    const previous = await loadGenerationRow(userId);
    if (previous !== null) {
      await learnDuration(previous, now);
    }
    // Carry the percentage reached so far into the new step instead of
    // restarting from a fixed checkpoint, so a skipped step cannot cause a jump.
    const from =
      previous === null
        ? PLAN_GENERATION_START
        : reportedProgress(previous, now.getTime());
    const expectedMs = await expectedDurationMs(step);
    await db
      .update(planGenerations)
      .set({
        step: step.label,
        stepId: step.id,
        progress: from,
        progressEnd: step.target,
        stepStartedAt: now,
        stepExpectedMs: expectedMs,
        updatedAt: now,
      })
      .where(
        and(
          eq(planGenerations.userId, userId),
          eq(planGenerations.runId, runId),
        ),
      );
  },

  async heartbeat(userId, runId) {
    // Only the lease timestamp moves; the step clock stays put so progress
    // keeps reflecting how long the current step has actually been running.
    await db
      .update(planGenerations)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(planGenerations.userId, userId),
          eq(planGenerations.runId, runId),
          eq(planGenerations.status, "running"),
        ),
      );
  },

  async finish(userId, runId) {
    const now = new Date();
    const previous = await loadGenerationRow(userId);
    if (previous !== null) {
      await learnDuration(previous, now);
    }
    await db
      .update(planGenerations)
      .set({
        status: "done",
        step: "Your plan is ready",
        stepId: null,
        progress: 100,
        progressEnd: 100,
        stepStartedAt: null,
        stepExpectedMs: 0,
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(planGenerations.userId, userId),
          eq(planGenerations.runId, runId),
        ),
      );
  },

  async fail(userId, error, runId) {
    const now = new Date();
    const previous = await loadGenerationRow(userId);
    if (previous === null || previous.runId !== runId) {
      return null;
    }
    if (runId === null && previous.status !== "running") {
      return null;
    }
    // Keep the percentage the athlete last saw instead of falling back to the
    // start of the failed step.
    const reached = reportedProgress(previous, now.getTime());
    const [row] = await db
      .update(planGenerations)
      .set({
        status: "error",
        step: "The coach could not finish your plan",
        stepStartedAt: null,
        progress: reached,
        error,
        updatedAt: now,
      })
      .where(
        and(
          eq(planGenerations.userId, userId),
          runId === null
            ? isNull(planGenerations.runId)
            : eq(planGenerations.runId, runId),
          eq(planGenerations.status, "running"),
        ),
      )
      .returning({ startedAt: planGenerations.startedAt });
    if (row === undefined) {
      // A heartbeat or a newer run replaced the status after it was read.
      return null;
    }
    await learnDuration(previous, now);
    return row.startedAt;
  },
};

/** The status returned before the first generation has ever run. */
export function idleGenerationStatus(): PlanGenerationStatus {
  return {
    status: "idle",
    step: null,
    progress: 0,
    error: null,
    runId: null,
    updatedAt: new Date().toISOString(),
  };
}
