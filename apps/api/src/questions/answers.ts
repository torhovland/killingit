import type { QuestionAnswerInput } from "@killingit/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  coachingSurveyAdjustments,
  questionAnswers,
  type QuestionAnswerRow,
} from "../db/schema.js";
import {
  listActiveQuestionsWithVersions,
  type StoredQuestion,
  type StoredQuestionVersion,
  type StoredQuestionWithVersions,
} from "./store.js";

/** An earlier version the athlete responded to, with that response. */
export interface StoredAthleteQuestionPreviousResponse {
  versionId: number;
  version: number;
  prompt: string;
  answer: string | null;
  skipped: boolean;
  answeredAt: Date;
}

/** An active question with the signed-in athlete's response to its current version. */
export interface StoredAthleteQuestion extends StoredQuestion {
  answer: string | null;
  /** True when the athlete explicitly left this optional question blank. */
  skipped: boolean;
  answeredAt: Date | null;
  /** The newest earlier version the athlete responded to, if any. */
  previous: StoredAthleteQuestionPreviousResponse | null;
}

/** One survey answer the coach has not incorporated into the plan yet. */
export interface CoachingSurveyAdjustmentDraft {
  question: string;
  previousQuestion: string | null;
  answer: string | null;
  previousAnswer: string | null;
}

/** The version and the response used to build a previous-response snapshot. */
export interface PreviousAnswerVersion<
  T extends { answer: string | null } = QuestionAnswerRow,
> {
  version: StoredQuestionVersion;
  answer: T;
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
    const activeQuestions = await listActiveQuestionsWithVersions();
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
            activeQuestions.flatMap((question) =>
              question.versions.map((version) => version.versionId),
            ),
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
        previousAnsweredVersion(question, answerByVersion),
      ),
    );
  },

  async saveAnswers(userId, answers) {
    if (answers.length === 0) {
      return true;
    }

    const activeQuestions = await listActiveQuestionsWithVersions();
    if (!answersMatchCurrentQuestions(activeQuestions, answers)) {
      return false;
    }

    const versionIds = activeQuestions.flatMap((question) =>
      question.versions.map((version) => version.versionId),
    );

    return db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(questionAnswers)
        .where(
          and(
            eq(questionAnswers.userId, userId),
            inArray(questionAnswers.questionVersionId, versionIds),
          ),
        );
      const answerByVersion = new Map(
        existingRows.map((answer) => [answer.questionVersionId, answer]),
      );
      const adjustments = buildCoachingSurveyAdjustments(
        activeQuestions,
        answerByVersion,
        answers,
      );

      const now = new Date();
      await tx
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

      if (adjustments.length > 0) {
        await tx.insert(coachingSurveyAdjustments).values(
          adjustments.map((adjustment) => ({
            userId,
            ...adjustment,
            createdAt: now,
          })),
        );
      }

      return true;
    });
  },
};

/**
 * Pure mapping from a question and the athlete's answer rows for its current
 * and an earlier version. Kept separate so answer selection is testable without
 * a database.
 */
export function toStoredAthleteQuestion(
  question: StoredQuestion,
  answer: QuestionAnswerRow | null,
  previous: PreviousAnswerVersion | null = null,
): StoredAthleteQuestion {
  return {
    ...question,
    answer: answer?.answer ?? null,
    skipped: answer !== null && answer.answer === null,
    answeredAt: answer?.updatedAt ?? null,
    previous: toPreviousResponse(previous),
  };
}

/**
 * Builds the adjustments an answer save creates. A new version, a changed
 * answer, and a skip all count; an unchanged resubmission does not. The earlier
 * wording and answer are snapshotted so the coach can see what changed.
 */
export function buildCoachingSurveyAdjustments(
  questions: readonly StoredQuestionWithVersions[],
  answersByVersionId: ReadonlyMap<number, Pick<QuestionAnswerRow, "answer">>,
  submitted: readonly QuestionAnswerInput[],
): CoachingSurveyAdjustmentDraft[] {
  const questionById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const adjustments: CoachingSurveyAdjustmentDraft[] = [];

  for (const entry of submitted) {
    const question = questionById.get(entry.questionId);
    if (!question || question.versionId !== entry.versionId) {
      continue;
    }

    const existing = answersByVersionId.get(entry.versionId);
    if (existing !== undefined && existing.answer === entry.answer) {
      continue;
    }

    const previous = previousAnsweredVersion(question, answersByVersionId);
    adjustments.push({
      question: question.prompt,
      previousQuestion:
        existing !== undefined
          ? question.prompt
          : (previous?.version.prompt ?? null),
      previousAnswer:
        existing !== undefined
          ? existing.answer
          : (previous?.answer.answer ?? null),
      answer: entry.answer,
    });
  }

  return adjustments;
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

/** The newest version before the current one that the athlete responded to. */
function previousAnsweredVersion<T extends { answer: string | null }>(
  question: StoredQuestionWithVersions,
  answersByVersionId: ReadonlyMap<number, T>,
): PreviousAnswerVersion<T> | null {
  for (let index = question.versions.length - 1; index >= 0; index -= 1) {
    const version = question.versions[index];
    if (version === undefined || version.version >= question.version) {
      continue;
    }
    const answer = answersByVersionId.get(version.versionId);
    if (answer !== undefined) {
      return { version, answer };
    }
  }
  return null;
}

function toPreviousResponse(
  previous: PreviousAnswerVersion<QuestionAnswerRow> | null,
): StoredAthleteQuestionPreviousResponse | null {
  if (previous === null) {
    return null;
  }
  return {
    versionId: previous.version.versionId,
    version: previous.version.version,
    prompt: previous.version.prompt,
    answer: previous.answer.answer,
    skipped: previous.answer.answer === null,
    answeredAt: previous.answer.updatedAt,
  };
}
