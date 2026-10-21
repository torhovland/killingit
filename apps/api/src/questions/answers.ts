import type { QuestionAnswerInput } from "@killingit/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { questionAnswers, type QuestionAnswerRow } from "../db/schema.js";
import { listActiveQuestions, type StoredQuestion } from "./store.js";

/** An active question with the signed-in athlete's response to its current version. */
export interface StoredAthleteQuestion extends StoredQuestion {
  answer: string | null;
  /** True when the athlete explicitly left this optional question blank. */
  skipped: boolean;
  answeredAt: Date | null;
}

/**
 * Pure mapping from a question and the athlete's answer row for its current
 * version. Kept separate so answer selection is testable without a database.
 */
export function toStoredAthleteQuestion(
  question: StoredQuestion,
  answer: QuestionAnswerRow | null,
): StoredAthleteQuestion {
  return {
    ...question,
    answer: answer?.answer ?? null,
    skipped: answer !== null && answer.answer === null,
    answeredAt: answer?.updatedAt ?? null,
  };
}

/**
 * Validates a submission against the active question set. Every entry must name
 * an active question and its current version, each question may appear only
 * once, and a required question cannot be skipped. Returns false for stale,
 * archived, unknown, duplicate, or invalid entries.
 */
export function answersMatchCurrentQuestions(
  activeQuestions: readonly StoredQuestion[],
  answers: readonly QuestionAnswerInput[],
): boolean {
  const questionById = new Map(
    activeQuestions.map((question) => [question.id, question]),
  );
  const answeredQuestionIds = new Set<number>();

  for (const entry of answers) {
    const question = questionById.get(entry.questionId);
    if (!question || question.versionId !== entry.versionId) {
      return false;
    }
    if (entry.answer === null && question.required) {
      return false;
    }
    if (answeredQuestionIds.has(entry.questionId)) {
      return false;
    }
    answeredQuestionIds.add(entry.questionId);
  }

  return true;
}

/**
 * Athlete-facing answer storage. Kept behind an interface so routes can be
 * tested without Postgres (matching the user/question store pattern).
 */
export interface QuestionAnswerStore {
  /** Active questions joined with this user's answers to their current versions. */
  listForUser(userId: number): Promise<StoredAthleteQuestion[]>;
  /**
   * Upserts answers or skips pinned to current question versions. Returns false
   * when any entry is stale or skips a required question.
   */
  saveAnswers(
    userId: number,
    answers: readonly QuestionAnswerInput[],
  ): Promise<boolean>;
}

/** PostgreSQL-backed answer store. */
export const dbQuestionAnswerStore: QuestionAnswerStore = {
  async listForUser(userId) {
    const activeQuestions = await listActiveQuestions();
    if (activeQuestions.length === 0) {
      return [];
    }

    const answerRows = await db
      .select()
      .from(questionAnswers)
      .where(
        and(
          eq(questionAnswers.userId, userId),
          inArray(
            questionAnswers.questionVersionId,
            activeQuestions.map((question) => question.versionId),
          ),
        ),
      );

    const answerByVersion = new Map(
      answerRows.map((answer) => [answer.questionVersionId, answer]),
    );

    return activeQuestions.map((question) =>
      toStoredAthleteQuestion(
        question,
        answerByVersion.get(question.versionId) ?? null,
      ),
    );
  },

  async saveAnswers(userId, answers) {
    if (answers.length === 0) {
      return true;
    }

    const activeQuestions = await listActiveQuestions();
    if (!answersMatchCurrentQuestions(activeQuestions, answers)) {
      return false;
    }

    const now = new Date();
    await db
      .insert(questionAnswers)
      .values(
        answers.map((entry) => ({
          userId,
          questionVersionId: entry.versionId,
          answer: entry.answer,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [questionAnswers.userId, questionAnswers.questionVersionId],
        set: {
          answer: sql`excluded.answer`,
          updatedAt: now,
        },
      });

    return true;
  },
};
