import { asc, eq } from "drizzle-orm";
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
  /** Drops every pending adjustment after a successful plan refresh. */
  clearForUser(userId: number): Promise<void>;
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

  async clearForUser(userId) {
    await db
      .delete(coachingSurveyAdjustments)
      .where(eq(coachingSurveyAdjustments.userId, userId));
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
