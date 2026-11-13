import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  coachingSurveyAdjustments,
  type CoachingSurveyAdjustmentRow,
} from "../db/schema.js";

/** One survey answer the coach has not incorporated into the plan yet. */
export interface StoredCoachingSurveyAdjustment {
  id: number;
  question: string;
  previousQuestion: string | null;
  answer: string | null;
  previousAnswer: string | null;
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

export function toStoredCoachingSurveyAdjustment(
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
