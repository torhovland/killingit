import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbExecutor } from "../db/index.js";
import {
  coachingSurveyAdjustments,
  type CoachingSurveyAdjustmentRow,
} from "../db/schema.js";

/**
 * One survey answer the coach has not incorporated into the plan yet. The
 * survey save builds it, the store writes it, and the plan prompt reads it, so
 * the snapshot's shape is declared once here.
 */
export interface CoachingSurveyAdjustment {
  question: string;
  previousQuestion: string | null;
  answer: string | null;
  previousAnswer: string | null;
}

/** A stored adjustment, with the row identity a refresh consumes. */
export interface StoredCoachingSurveyAdjustment extends CoachingSurveyAdjustment {
  id: number;
  createdAt: Date;
}

/**
 * The pending survey adjustments for one athlete. Kept behind an interface so
 * plan generation can be tested without Postgres.
 */
export interface CoachingSurveyAdjustmentStore {
  /** Every adjustment in the order it was made, oldest first. */
  listForUser(userId: number): Promise<StoredCoachingSurveyAdjustment[]>;
  /**
   * Appends the snapshots one answer save produced. Pass the transaction that
   * saves the answers, so the record of a change cannot outlive a failed save.
   */
  append(
    userId: number,
    adjustments: readonly CoachingSurveyAdjustment[],
    executor?: DbExecutor,
  ): Promise<void>;
  /**
   * Drops the adjustments a refresh loaded into its prompt. Passing the loaded
   * ids rather than clearing every row keeps an answer the athlete edits while
   * the run is generating for the next refresh.
   */
  clearConsumed(
    userId: number,
    adjustmentIds: readonly number[],
  ): Promise<void>;
}

/** PostgreSQL-backed pending survey adjustment store. */
export const dbCoachingSurveyAdjustmentStore: CoachingSurveyAdjustmentStore = {
  async listForUser(userId) {
    const rows = await db
      .select()
      .from(coachingSurveyAdjustments)
      .where(eq(coachingSurveyAdjustments.userId, userId))
      .orderBy(
        asc(coachingSurveyAdjustments.createdAt),
        asc(coachingSurveyAdjustments.id),
      );
    return rows.map(toStoredCoachingSurveyAdjustment);
  },

  async append(userId, adjustments, executor = db) {
    if (adjustments.length === 0) {
      return;
    }
    await executor
      .insert(coachingSurveyAdjustments)
      .values(adjustments.map((adjustment) => ({ userId, ...adjustment })));
  },

  async clearConsumed(userId, adjustmentIds) {
    if (adjustmentIds.length === 0) {
      return;
    }
    await db
      .delete(coachingSurveyAdjustments)
      .where(
        and(
          eq(coachingSurveyAdjustments.userId, userId),
          inArray(coachingSurveyAdjustments.id, [...adjustmentIds]),
        ),
      );
  },
};

function toStoredCoachingSurveyAdjustment(
  row: CoachingSurveyAdjustmentRow,
): StoredCoachingSurveyAdjustment {
  return {
    id: row.id,
    question: row.question,
    previousQuestion: row.previousQuestion,
    answer: row.answer,
    previousAnswer: row.previousAnswer,
    createdAt: row.createdAt,
  };
}
