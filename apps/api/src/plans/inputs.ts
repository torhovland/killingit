import type {
  ActivityCommentInput,
  ManualActivityInput,
} from "@killingit/shared";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  activityComments,
  activityDeletions,
  coachReplies,
  manualActivities,
  weeklyNotes,
} from "../db/schema.js";
import type {
  ActivityCommentContext,
  ManualActivityContext,
} from "../llm/activityContext.js";
import type { PeriodReviewContext } from "../llm/planContext.js";
import { startOfWeek } from "@killingit/shared";
import { loadPeriodReviews } from "./periodReviews.js";
import {
  summarizeCoachingInputChanges,
  summarizeReviewChanges,
} from "./inputChanges.js";
import { loadWeeklyNoteReply } from "./replies.js";

/** A manual entry plus the coach's TSS estimate, when one has been made. */
export type ManualActivityWriteInput = ManualActivityInput & {
  estimatedTss?: number | null;
};

/** Everything the athlete has added on top of their synced training. */
export interface CoachingInputs {
  manualActivities: ManualActivityContext[];
  activityComments: ActivityCommentContext[];
  weeklyNote: string | null;
  /** The Monday of the week the current note belongs to. */
  weeklyNoteWeekStartDate: string | null;
  /** The coach's reply to the current week's note, if one exists. */
  weeklyNoteReply: string | null;
  /** When the current week's note was last saved. */
  weeklyNoteUpdatedAt: Date | null;
  /** Coach summaries of completed weeks and blocks, with athlete feedback. */
  periodReviews: PeriodReviewContext[];
  /**
   * Every stored weekly note, so the coach reading dated events still sees a
   * race named in an earlier week's note. Optional because test fixtures that
   * only describe the current week do not need it.
   */
  weeklyNotes?: StoredWeeklyNote[];
  /**
   * The newest week review event: when a week review was generated or when its
   * comment was answered. A newer week review makes the block pending so the
   * coach can respond to the completed week's feedback.
   */
  weekReviewUpdatedAt: Date | null;
  /** The newest week review event asks for a plan refresh. */
  weekReviewNeedsRefresh: boolean;
  /**
   * The newest block review event: when a block review was generated or when
   * its comment was answered. A newer block review makes the season pending.
   */
  blockReviewUpdatedAt: Date | null;
  /** The newest block review event asks for a plan refresh. */
  blockReviewNeedsRefresh: boolean;
  /** The newest `updatedAt` across all coaching inputs. */
  updatedAt: Date | null;
  /**
   * The newest input whose coach reply asked for a plan change. A missing reply
   * counts as a request, so a failed reply never drops a needed refresh.
   */
  refreshUpdatedAt: Date | null;
}

/**
 * Loads the coaching inputs that sit alongside the synced activities: manually
 * recorded activities, activity comments, the note for `weekStartDate`, and
 * completed week/block reviews. `updatedAt` is the newest athlete input of any
 * kind; `refreshUpdatedAt` is the newest one whose coach reply asked for a plan
 * change, which is what makes the plan stale.
 */
export async function loadCoachingInputs(
  userId: number,
  weekStartDate: string,
): Promise<CoachingInputs> {
  const [
    manualRows,
    commentRows,
    noteRows,
    deletionRows,
    reviewEntries,
    noteReply,
    replyRows,
  ] = await Promise.all([
    db
      .select()
      .from(manualActivities)
      .where(eq(manualActivities.userId, userId)),
    db
      .select()
      .from(activityComments)
      .where(eq(activityComments.userId, userId)),
    db.select().from(weeklyNotes).where(eq(weeklyNotes.userId, userId)),
    db
      .select()
      .from(activityDeletions)
      .where(eq(activityDeletions.userId, userId)),
    loadPeriodReviews(userId),
    loadWeeklyNoteReply(userId, weekStartDate),
    db.select().from(coachReplies).where(eq(coachReplies.userId, userId)),
  ]);

  // The coach's flag for each input. A missing reply is unknown, not false.
  const replyFlags = new Map<string, boolean>();
  for (const row of replyRows) {
    replyFlags.set(`${row.kind}:${row.target}`, row.planChangeNeeded);
  }
  const replyFlag = (kind: string, target: string | number): boolean =>
    replyFlags.get(`${kind}:${target}`) ?? true;

  const reviewChanges = reviewEntries.map(({ review, reply }) => ({
    kind: review.kind,
    // A generated summary matters even before anyone comments. Once the
    // athlete answers it, the comment's timestamp is the newer event.
    updatedAt: review.comment !== null ? review.updatedAt : review.generatedAt,
    planChangeNeeded:
      review.comment === null ? true : (reply?.planChangeNeeded ?? true),
  }));
  const reviews = summarizeReviewChanges(reviewChanges);

  const inputs = summarizeCoachingInputChanges([
    ...manualRows.map((row) => ({
      updatedAt: row.updatedAt,
      planChangeNeeded: replyFlag("manual_activity", row.id),
    })),
    ...commentRows.map((row) => ({
      updatedAt: row.updatedAt,
      planChangeNeeded: replyFlag("activity_comment", row.activityId),
    })),
    ...noteRows.map((row) => ({
      updatedAt: row.updatedAt,
      planChangeNeeded: replyFlag("weekly_note", row.weekStartDate),
    })),
    // Deleting an activity removes training data, which always changes the
    // plan's load picture.
    ...deletionRows.map((row) => ({
      updatedAt: row.updatedAt,
      planChangeNeeded: true,
    })),
    ...reviewChanges,
  ]);

  const currentNote =
    noteRows.find((row) => row.weekStartDate === weekStartDate) ?? null;

  return {
    manualActivities: manualRows.map((row) => ({
      id: row.id,
      startDate: row.startDate,
      details: row.details,
      estimatedTss: row.estimatedTss,
      updatedAt: row.updatedAt.toISOString(),
    })),
    activityComments: commentRows.map((row) => ({
      activityId: row.activityId,
      comment: row.comment,
      updatedAt: row.updatedAt.toISOString(),
    })),
    weeklyNote: currentNote?.note ?? null,
    weeklyNoteWeekStartDate: currentNote === null ? null : weekStartDate,
    weeklyNoteReply: noteReply?.text ?? null,
    weeklyNoteUpdatedAt: currentNote?.updatedAt ?? null,
    weeklyNotes: noteRows.map((row) => ({
      weekStartDate: row.weekStartDate,
      note: row.note,
      updatedAt: row.updatedAt,
    })),
    periodReviews: reviewEntries.map(({ review, reply, weeklyNote }) => ({
      kind: review.kind,
      title: review.title,
      startDate: review.startDate,
      endDate: review.endDate,
      summary: review.summary,
      comment: review.comment,
      reply: reply?.text ?? null,
      weeklyNote:
        weeklyNote === undefined || weeklyNote === null
          ? null
          : {
              note: weeklyNote.note,
              reply: weeklyNote.reply?.text ?? null,
            },
      updatedAt: review.updatedAt.toISOString(),
    })),
    weekReviewUpdatedAt: reviews.weekUpdatedAt,
    weekReviewNeedsRefresh: reviews.weekNeedsRefresh,
    blockReviewUpdatedAt: reviews.blockUpdatedAt,
    blockReviewNeedsRefresh: reviews.blockNeedsRefresh,
    updatedAt: inputs.updatedAt,
    refreshUpdatedAt: inputs.refreshUpdatedAt,
  };
}

/**
 * Activity comments the coach has not answered yet. One batched reply covers
 * all of them, so two comments saved close together do not need two prompts.
 */
export async function loadUnansweredActivityComments(
  userId: number,
): Promise<ActivityCommentContext[]> {
  const rows = await db
    .select({
      activityId: activityComments.activityId,
      comment: activityComments.comment,
      updatedAt: activityComments.updatedAt,
    })
    .from(activityComments)
    .leftJoin(
      coachReplies,
      and(
        eq(coachReplies.userId, activityComments.userId),
        eq(coachReplies.kind, "activity_comment"),
        eq(coachReplies.target, activityComments.activityId),
      ),
    )
    .where(and(eq(activityComments.userId, userId), isNull(coachReplies.id)));

  return rows.map((row) => ({
    activityId: row.activityId,
    comment: row.comment,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** Loads all manual activities for a user. */
export async function loadManualActivities(
  userId: number,
): Promise<ManualActivityContext[]> {
  const rows = await db
    .select()
    .from(manualActivities)
    .where(eq(manualActivities.userId, userId));
  return rows.map((row) => ({
    id: row.id,
    startDate: row.startDate,
    details: row.details,
    estimatedTss: row.estimatedTss,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Updates a manual activity. The plan's stored input timestamp is deliberately
 * left unchanged: it still points at the inputs the plan was generated from, so
 * the newer activity makes the plan stale and triggers a revision.
 */
export async function updateManualActivity(
  userId: number,
  activityId: number,
  input: ManualActivityWriteInput,
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(manualActivities)
    .set({
      startDate: input.startDate,
      details: input.details,
      estimatedTss: input.estimatedTss ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(manualActivities.userId, userId),
        eq(manualActivities.id, activityId),
      ),
    )
    .returning({ id: manualActivities.id });
  return rows.length > 0;
}

/**
 * Stores the coach's TSS estimate on an existing manual activity. The row was
 * already confirmed by the update, so this narrow write does not repeat the
 * other fields.
 */
export async function updateManualActivityTss(
  userId: number,
  activityId: number,
  estimatedTss: number,
): Promise<void> {
  await db
    .update(manualActivities)
    .set({ estimatedTss, updatedAt: new Date() })
    .where(
      and(
        eq(manualActivities.userId, userId),
        eq(manualActivities.id, activityId),
      ),
    );
}

/**
 * Records a manual activity. The plan's stored input timestamp is deliberately
 * left unchanged so the next status read sees the newer input and regenerates.
 */
export async function saveManualActivity(
  userId: number,
  input: ManualActivityWriteInput,
): Promise<number> {
  const now = new Date();
  const [row] = await db
    .insert(manualActivities)
    .values({
      userId,
      startDate: input.startDate,
      details: input.details,
      estimatedTss: input.estimatedTss ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: manualActivities.id });
  if (!row) {
    throw new Error("failed to persist the manual activity");
  }
  return row.id;
}

/**
 * Adds the one comment an activity is allowed to have. Returns false when a
 * comment already exists, so the caller can reject a second add rather than
 * silently replacing the existing comment.
 */
export async function createActivityComment(
  userId: number,
  input: ActivityCommentInput,
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .insert(activityComments)
    .values({
      userId,
      activityId: input.activityId,
      comment: input.comment,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [activityComments.userId, activityComments.activityId],
    })
    .returning({ id: activityComments.id });
  return rows.length > 0;
}

/**
 * Edits an existing activity comment. Returns false when the activity has no
 * comment yet. The plan's stored input timestamp stays unchanged, so the newer
 * `updatedAt` makes the plan stale and triggers a revision.
 */
export async function updateActivityComment(
  userId: number,
  input: ActivityCommentInput,
): Promise<boolean> {
  const rows = await db
    .update(activityComments)
    .set({ comment: input.comment, updatedAt: new Date() })
    .where(
      and(
        eq(activityComments.userId, userId),
        eq(activityComments.activityId, input.activityId),
      ),
    )
    .returning({ id: activityComments.id });
  return rows.length > 0;
}

/** Loads the note for `weekStartDate`, or null when none was saved. */
export async function loadWeeklyNote(
  userId: number,
  weekStartDate: string,
): Promise<string | null> {
  const rows = await db
    .select({ note: weeklyNotes.note })
    .from(weeklyNotes)
    .where(
      and(
        eq(weeklyNotes.userId, userId),
        eq(weeklyNotes.weekStartDate, weekStartDate),
      ),
    )
    .limit(1);
  return rows[0]?.note ?? null;
}

/** One stored weekly note with the date it was written. */
export interface StoredWeeklyNote {
  weekStartDate: string;
  note: string;
  updatedAt: Date;
}

/** The plan's stored input timestamp stays unchanged so the next read regenerates. */
export async function saveWeeklyNote(
  userId: number,
  today: string,
  note: string,
): Promise<void> {
  const weekStartDate = startOfWeek(today);
  const now = new Date();
  await db
    .insert(weeklyNotes)
    .values({
      userId,
      weekStartDate,
      note,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [weeklyNotes.userId, weeklyNotes.weekStartDate],
      set: { note, updatedAt: now },
    });
}
