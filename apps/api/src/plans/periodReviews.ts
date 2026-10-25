import type { PeriodReview, ReviewKind } from "@killingit/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  coachReplies,
  periodReviews,
  weeklyNotes,
  type CoachReplyRow,
  type WeeklyNoteRow,
} from "../db/schema.js";
import { toCoachAnalysis, type StoredCoachReply } from "./replies.js";

/** A stored week or block review before it is turned into the API shape. */
export interface StoredPeriodReview {
  kind: ReviewKind;
  startDate: string;
  endDate: string;
  title: string;
  summary: string;
  model: string;
  promptVersion: number;
  comment: string | null;
  reviewed: boolean;
  generatedAt: Date;
  updatedAt: Date;
}

export interface PeriodReviewWithReply {
  review: StoredPeriodReview;
  reply: StoredCoachReply | null;
  /** The weekly note saved for a week review and the coach's reply to it. */
  weeklyNote?: StoredWeeklyNote | null;
}

/** The athlete's note for a week and the coach's reply to that note. */
export interface StoredWeeklyNote {
  note: string;
  reply: StoredCoachReply | null;
}

function replyKind(kind: ReviewKind): "week_review" | "block_review" {
  return kind === "week" ? "week_review" : "block_review";
}

/** Loads every week/block review for a user with its coach reply. */
export async function loadPeriodReviews(
  userId: number,
): Promise<PeriodReviewWithReply[]> {
  const rows = await db
    .select()
    .from(periodReviews)
    .where(eq(periodReviews.userId, userId));

  if (rows.length === 0) {
    return [];
  }

  const reviewRows = rows.map((row) => ({
    kind: row.kind === "week" ? ("week" as const) : ("block" as const),
    startDate: row.startDate,
    endDate: row.endDate,
    title: row.title,
    summary: row.summary,
    model: row.model,
    promptVersion: row.promptVersion,
    comment: row.comment,
    reviewed: row.reviewed,
    generatedAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const weekStartDates = reviewRows
    .filter((review) => review.kind === "week")
    .map((review) => review.startDate);

  const [replyRows, noteRows, noteReplyRows] = await Promise.all([
    db
      .select()
      .from(coachReplies)
      .where(
        and(
          eq(coachReplies.userId, userId),
          inArray(coachReplies.kind, ["week_review", "block_review"]),
        ),
      ),
    weekStartDates.length === 0
      ? Promise.resolve([] as WeeklyNoteRow[])
      : db
          .select()
          .from(weeklyNotes)
          .where(
            and(
              eq(weeklyNotes.userId, userId),
              inArray(weeklyNotes.weekStartDate, weekStartDates),
            ),
          ),
    weekStartDates.length === 0
      ? Promise.resolve([] as CoachReplyRow[])
      : db
          .select()
          .from(coachReplies)
          .where(
            and(
              eq(coachReplies.userId, userId),
              eq(coachReplies.kind, "weekly_note"),
              inArray(coachReplies.target, weekStartDates),
            ),
          ),
  ]);

  const replies = new Map<string, StoredCoachReply>();
  for (const row of replyRows) {
    replies.set(`${row.kind}:${row.target}`, {
      kind: row.kind,
      target: row.target,
      text: row.reply,
      model: row.model,
      generatedAt: row.updatedAt,
    });
  }

  const notes = new Map<string, string>();
  for (const row of noteRows) {
    notes.set(row.weekStartDate, row.note);
  }

  const noteReplies = new Map<string, StoredCoachReply>();
  for (const row of noteReplyRows) {
    noteReplies.set(row.target, {
      kind: row.kind,
      target: row.target,
      text: row.reply,
      model: row.model,
      generatedAt: row.updatedAt,
    });
  }

  return reviewRows.map((review) => {
    const note =
      review.kind === "week" ? notes.get(review.startDate) : undefined;
    return {
      review,
      reply:
        replies.get(`${replyKind(review.kind)}:${review.startDate}`) ?? null,
      weeklyNote:
        note === undefined
          ? null
          : {
              note,
              reply: noteReplies.get(review.startDate) ?? null,
            },
    };
  });
}

/** Loads one review, or null when it does not exist. */
export async function loadPeriodReview(
  userId: number,
  kind: ReviewKind,
  startDate: string,
): Promise<StoredPeriodReview | null> {
  const rows = await db
    .select()
    .from(periodReviews)
    .where(
      and(
        eq(periodReviews.userId, userId),
        eq(periodReviews.kind, kind),
        eq(periodReviews.startDate, startDate),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    kind: row.kind === "week" ? "week" : "block",
    startDate: row.startDate,
    endDate: row.endDate,
    title: row.title,
    summary: row.summary,
    model: row.model,
    promptVersion: row.promptVersion,
    comment: row.comment,
    reviewed: row.reviewed,
    generatedAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Stores a generated review. A concurrent generation may already have written
 * it, so an existing row is left untouched.
 */
export async function savePeriodReview(input: {
  userId: number;
  kind: ReviewKind;
  startDate: string;
  endDate: string;
  title: string;
  summary: string;
  model: string;
  promptVersion: number;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(periodReviews)
    .values({
      userId: input.userId,
      kind: input.kind,
      startDate: input.startDate,
      endDate: input.endDate,
      title: input.title,
      summary: input.summary,
      model: input.model,
      promptVersion: input.promptVersion,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        periodReviews.userId,
        periodReviews.kind,
        periodReviews.startDate,
      ],
    });
}

/**
 * Adds the single comment a review may have. Returns false when one already
 * exists, so a second add is rejected instead of silently replacing it.
 */
export async function createPeriodReviewComment(
  userId: number,
  kind: ReviewKind,
  startDate: string,
  comment: string,
): Promise<boolean> {
  const rows = await db
    .update(periodReviews)
    .set({ comment, updatedAt: new Date() })
    .where(
      and(
        eq(periodReviews.userId, userId),
        eq(periodReviews.kind, kind),
        eq(periodReviews.startDate, startDate),
        isNull(periodReviews.comment),
      ),
    )
    .returning({ id: periodReviews.id });
  return rows.length > 0;
}

/**
 * Edits an existing review comment. The review timestamp deliberately moves so
 * the next plan read sees the newer input and revises the plan.
 */
export async function updatePeriodReviewComment(
  userId: number,
  kind: ReviewKind,
  startDate: string,
  comment: string,
): Promise<boolean> {
  const rows = await db
    .update(periodReviews)
    .set({ comment, updatedAt: new Date() })
    .where(
      and(
        eq(periodReviews.userId, userId),
        eq(periodReviews.kind, kind),
        eq(periodReviews.startDate, startDate),
      ),
    )
    .returning({ id: periodReviews.id });
  return rows.length > 0;
}

/** Records that the athlete acknowledged a review with "No comment". */
export async function markPeriodReviewReviewed(
  userId: number,
  kind: ReviewKind,
  startDate: string,
): Promise<boolean> {
  const rows = await db
    .update(periodReviews)
    .set({ reviewed: true, updatedAt: new Date() })
    .where(
      and(
        eq(periodReviews.userId, userId),
        eq(periodReviews.kind, kind),
        eq(periodReviews.startDate, startDate),
      ),
    )
    .returning({ id: periodReviews.id });
  return rows.length > 0;
}

/** Converts a stored review and reply into the shared API shape. */
export function toPeriodReview(entry: PeriodReviewWithReply): PeriodReview {
  return {
    kind: entry.review.kind,
    startDate: entry.review.startDate,
    endDate: entry.review.endDate,
    title: entry.review.title,
    summary: toCoachAnalysis({
      text: entry.review.summary,
      model: entry.review.model,
      generatedAt: entry.review.generatedAt,
    }),
    comment: entry.review.comment,
    coachReply: entry.reply ? toCoachAnalysis(entry.reply) : null,
    weeklyNote:
      entry.review.kind === "week" && entry.weeklyNote
        ? {
            note: entry.weeklyNote.note,
            coachReply: entry.weeklyNote.reply
              ? toCoachAnalysis(entry.weeklyNote.reply)
              : null,
          }
        : null,
    reviewed: entry.review.reviewed,
  };
}
