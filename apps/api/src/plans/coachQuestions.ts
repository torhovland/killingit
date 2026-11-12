import type { CoachQuestion } from "@killingit/shared";
import { and, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { coachQuestions, type CoachQuestionRow } from "../db/schema.js";

/**
 * The newest non-blank question in a response. A response may carry several
 * questions, but the athlete only ever sees the most recent one.
 */
export function newestCoachQuestion(
  questions: readonly string[],
): string | null {
  const newest = questions
    .map((question) => question.trim())
    .filter((question) => question !== "")
    .at(-1);
  return newest ?? null;
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
  | "athlete_reading"
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
 * Stores the newest clarification question, replacing any question that is
 * still pending. An account never has a queue of coach questions: the athlete
 * sees only the most recent one, and answering it leaves none behind.
 */
export async function saveCoachQuestions(
  input: SaveCoachQuestionsInput,
): Promise<void> {
  const newest = newestCoachQuestion(input.questions);
  if (newest === null) {
    return;
  }

  await db.transaction(async (tx) => {
    // Serialize question writes per account so two overlapping runs cannot
    // each leave a pending question behind.
    await tx.execute(
      sql`select id from users where id = ${input.userId} for update`,
    );
    const [pending] = await tx
      .select({ id: coachQuestions.id })
      .from(coachQuestions)
      .where(
        and(
          eq(coachQuestions.userId, input.userId),
          isNull(coachQuestions.answer),
        ),
      )
      .orderBy(desc(coachQuestions.createdAt), desc(coachQuestions.id))
      .limit(1);
    if (pending !== undefined) {
      await tx
        .update(coachQuestions)
        .set({
          question: newest,
          target: input.target ?? null,
          sourceKind: input.sourceKind,
          model: input.model,
          updatedAt: new Date(),
        })
        .where(eq(coachQuestions.id, pending.id));
      await tx
        .delete(coachQuestions)
        .where(
          and(
            eq(coachQuestions.userId, input.userId),
            isNull(coachQuestions.answer),
            ne(coachQuestions.id, pending.id),
          ),
        );
      return;
    }

    await tx.insert(coachQuestions).values({
      userId: input.userId,
      question: newest,
      target: input.target ?? null,
      sourceKind: input.sourceKind,
      model: input.model,
    });
  });
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
 * Saves the athlete's answer and the coach's reply. Returns null when the
 * question does not exist, belongs to another account, or was already answered.
 * Answering the pending question also clears every other pending question, so
 * no older question can surface after this one.
 */
export async function answerCoachQuestion(
  input: AnswerCoachQuestionInput,
): Promise<CoachQuestion | null> {
  const now = new Date();
  return db.transaction(async (tx) => {
    // Serialize with saveCoachQuestions so a concurrent run cannot slip a new
    // pending question in between the answer and the cleanup.
    await tx.execute(
      sql`select id from users where id = ${input.userId} for update`,
    );
    const [row] = await tx
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
    await tx
      .delete(coachQuestions)
      .where(
        and(
          eq(coachQuestions.userId, input.userId),
          isNull(coachQuestions.answer),
          ne(coachQuestions.id, row.id),
        ),
      );
    return toCoachQuestion(row);
  });
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
            planChangeNeeded: false,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
  };
}
