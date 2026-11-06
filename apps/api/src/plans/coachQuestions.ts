import type { CoachQuestion } from "@killingit/shared";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { coachQuestions, type CoachQuestionRow } from "../db/schema.js";

/** Filler words that do not change what a question is asking for. */
const QUESTION_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/**
 * How much of two questions' meaningful words must overlap before they count
 * as the same question. Two runs can word the same question slightly
 * differently, and only one of them should be shown to the athlete.
 */
const QUESTION_SIMILARITY_THRESHOLD = 0.8;

/** The meaningful words of a question, lowercased and without punctuation. */
export function normalizeCoachQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !QUESTION_STOP_WORDS.has(word))
    .join(" ");
}

/**
 * True when two questions ask the same thing after ignoring filler words and
 * wording differences. Used to keep a repeated model response from creating a
 * second pending question the athlete would see after answering the first.
 */
export function isSameCoachQuestion(left: string, right: string): boolean {
  const leftWords = new Set(
    normalizeCoachQuestion(left)
      .split(" ")
      .filter((word) => word !== ""),
  );
  const rightWords = new Set(
    normalizeCoachQuestion(right)
      .split(" ")
      .filter((word) => word !== ""),
  );
  if (leftWords.size === 0 || rightWords.size === 0) {
    return normalizeCoachQuestion(left) === normalizeCoachQuestion(right);
  }
  let shared = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      shared += 1;
    }
  }
  const union = new Set([...leftWords, ...rightWords]).size;
  return shared / union >= QUESTION_SIMILARITY_THRESHOLD;
}

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
  | "athlete_events"
  | "manual_tss";

export interface SaveCoachQuestionsInput {
  userId: number;
  questions: readonly string[];
  /** The activity id the question is about, when the prompt names one. */
  target?: string;
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
  const known = pending.map((row) => row.question);
  const fresh: string[] = [];
  for (const question of unique) {
    const repeatsPending = known.some((existing) =>
      isSameCoachQuestion(existing, question),
    );
    const repeatsFresh = fresh.some((existing) =>
      isSameCoachQuestion(existing, question),
    );
    if (!repeatsPending && !repeatsFresh) {
      fresh.push(question);
    }
  }
  if (fresh.length === 0) {
    return;
  }

  await db.insert(coachQuestions).values(
    fresh.map((question) => ({
      userId: input.userId,
      question,
      target: input.target ?? null,
      sourceKind: input.sourceKind,
      model: input.model,
    })),
  );
}

/**
 * Removes every unanswered question. A new season or season refresh replaces
 * the coaching context the coach asked about, so an old question would be
 * stale by the time the athlete reads it.
 */
export async function clearPendingCoachQuestions(
  userId: number,
): Promise<void> {
  await db
    .delete(coachQuestions)
    .where(
      and(eq(coachQuestions.userId, userId), isNull(coachQuestions.answer)),
    );
}

/**
 * Removes a pending question about one activity once a newer comment makes it
 * stale. Questions saved before the target column existed have no activity id,
 * so a re-analysis also clears those legacy activity-analysis questions.
 */
export async function clearPendingActivityQuestion(
  userId: number,
  activityId: string,
): Promise<void> {
  await db
    .delete(coachQuestions)
    .where(
      and(
        eq(coachQuestions.userId, userId),
        isNull(coachQuestions.answer),
        or(
          eq(coachQuestions.target, activityId),
          and(
            isNull(coachQuestions.target),
            eq(coachQuestions.sourceKind, "activity_analysis"),
          ),
        ),
      ),
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
 * Removes other pending questions that ask the same thing as the one just
 * answered. Two overlapping runs can save near-identical wordings; without
 * this, answering the newer one would reveal the older duplicate later.
 */
async function clearDuplicatePendingQuestions(
  userId: number,
  question: string,
  keepId: number,
): Promise<void> {
  try {
    const pending = await db
      .select({ id: coachQuestions.id, question: coachQuestions.question })
      .from(coachQuestions)
      .where(
        and(
          eq(coachQuestions.userId, userId),
          isNull(coachQuestions.answer),
          ne(coachQuestions.id, keepId),
        ),
      );
    const duplicateIds = pending
      .filter((row) => isSameCoachQuestion(row.question, question))
      .map((row) => row.id);
    if (duplicateIds.length === 0) {
      return;
    }
    await db
      .delete(coachQuestions)
      .where(
        and(
          eq(coachQuestions.userId, userId),
          inArray(coachQuestions.id, duplicateIds),
        ),
      );
  } catch (err) {
    // Clearing a duplicate must not fail the answer the athlete just gave.
    console.error(
      "[coach-questions] could not clear duplicate pending questions:",
      err,
    );
  }
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
  if (row === undefined) {
    return null;
  }
  await clearDuplicatePendingQuestions(input.userId, row.question, row.id);
  return toCoachQuestion(row);
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
