import type { CoachQuestion } from "@killingit/shared";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { coachQuestions, type CoachQuestionRow } from "../db/schema.js";

/** The prompt family that produced a clarification question. */
export type CoachQuestionSourceKind =
  | "season_plan"
  | "initial_block"
  | "weekly_update"
  | "daily_update"
  | "plan_update"
  | "coach_plan"
  | "activity_analysis"
  | "program_analysis"
  | "athlete_metrics"
  | "manual_tss";

export interface SaveCoachQuestionsInput {
  userId: number;
  questions: readonly string[];
  model: string;
  sourceKind: CoachQuestionSourceKind;
}

/**
 * Stores new clarification questions, skipping blanks and questions that are
 * already pending so a repeated model response does not create duplicates.
 */
export async function saveCoachQuestions(
  input: SaveCoachQuestionsInput,
): Promise<void> {
  const unique = [
    ...new Set(
      input.questions
        .map((question) => question.trim())
        .filter((question) => question !== ""),
    ),
  ];
  if (unique.length === 0) {
    return;
  }

  const pending = await db
    .select({ question: coachQuestions.question })
    .from(coachQuestions)
    .where(
      and(
        eq(coachQuestions.userId, input.userId),
        isNull(coachQuestions.answer),
      ),
    );
  const known = new Set(pending.map((row) => row.question));
  const fresh = unique.filter((question) => !known.has(question));
  if (fresh.length === 0) {
    return;
  }

  await db.insert(coachQuestions).values(
    fresh.map((question) => ({
      userId: input.userId,
      question,
      sourceKind: input.sourceKind,
      model: input.model,
    })),
  );
}

/** The newest unanswered question, or null when nothing is pending. */
export async function loadPendingCoachQuestion(
  userId: number,
): Promise<CoachQuestion | null> {
  const [row] = await db
    .select()
    .from(coachQuestions)
    .where(
      and(eq(coachQuestions.userId, userId), isNull(coachQuestions.answer)),
    )
    .orderBy(desc(coachQuestions.createdAt), desc(coachQuestions.id))
    .limit(1);
  return row === undefined ? null : toCoachQuestion(row);
}

/** Answered questions, newest answer first, for the season review. */
export async function loadAnsweredCoachQuestions(
  userId: number,
): Promise<CoachQuestion[]> {
  const rows = await db
    .select()
    .from(coachQuestions)
    .where(
      and(eq(coachQuestions.userId, userId), isNotNull(coachQuestions.answer)),
    )
    .orderBy(desc(coachQuestions.answeredAt), desc(coachQuestions.id));
  return rows.map(toCoachQuestion);
}

/** One question by id, scoped to its owner. */
export async function loadCoachQuestion(
  userId: number,
  id: number,
): Promise<CoachQuestion | null> {
  const [row] = await db
    .select()
    .from(coachQuestions)
    .where(and(eq(coachQuestions.userId, userId), eq(coachQuestions.id, id)))
    .limit(1);
  return row === undefined ? null : toCoachQuestion(row);
}

export interface AnswerCoachQuestionInput {
  userId: number;
  id: number;
  answer: string;
  reply: string | null;
  replyModel: string | null;
}

/**
 * Saves the athlete's answer and the coach's reply. Returns null when the
 * question does not exist, belongs to another account, or was already answered.
 */
export async function answerCoachQuestion(
  input: AnswerCoachQuestionInput,
): Promise<CoachQuestion | null> {
  const now = new Date();
  const [row] = await db
    .update(coachQuestions)
    .set({
      answer: input.answer,
      reply: input.reply,
      replyModel: input.replyModel,
      answeredAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(coachQuestions.userId, input.userId),
        eq(coachQuestions.id, input.id),
        isNull(coachQuestions.answer),
      ),
    )
    .returning();
  return row === undefined ? null : toCoachQuestion(row);
}

function toCoachQuestion(row: CoachQuestionRow): CoachQuestion {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    coachReply:
      row.reply !== null && row.replyModel !== null
        ? {
            text: row.reply,
            model: row.replyModel,
            generatedAt: (row.answeredAt ?? row.updatedAt).toISOString(),
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
  };
}
