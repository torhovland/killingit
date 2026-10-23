import type {
  ActivityCommentInput,
  ManualActivityInput,
} from "@killingit/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  activityComments,
  activityDeletions,
  manualActivities,
  weeklyNotes,
} from "../db/schema.js";
import type {
  ActivityCommentContext,
  ManualActivityContext,
  PeriodReviewContext,
} from "../llm/planContext.js";
import { startOfWeek } from "./dates.js";
import { loadPeriodReviews } from "./periodReviews.js";

/** Everything the athlete has added on top of their synced training. */
export interface CoachingInputs {
  manualActivities: ManualActivityContext[];
  activityComments: ActivityCommentContext[];
  weeklyNote: string | null;
  /** Coach summaries of completed weeks and blocks, with athlete feedback. */
  periodReviews: PeriodReviewContext[];
  /** The newest `updatedAt` across all coaching inputs. */
  updatedAt: Date | null;
}

function newest(rows: readonly { updatedAt: Date }[]): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if (latest === null || row.updatedAt.getTime() > latest.getTime()) {
      latest = row.updatedAt;
    }
  }
  return latest;
}

/**
 * Loads the coaching inputs that sit alongside the synced activities: manually
 * recorded activities, activity comments, the note for `weekStartDate`, and
 * completed week/block reviews. The returned `updatedAt` is the newest
 * athlete-input timestamp and drives the plan's automatic revision.
 */
export async function loadCoachingInputs(
  userId: number,
  weekStartDate: string,
): Promise<CoachingInputs> {
  const [manualRows, commentRows, noteRows, deletionRows, reviewEntries] =
    await Promise.all([
      db
        .select()
        .from(manualActivities)
        .where(eq(manualActivities.userId, userId)),
      db
        .select()
        .from(activityComments)
        .where(eq(activityComments.userId, userId)),
      db
        .select()
        .from(weeklyNotes)
        .where(
          and(
            eq(weeklyNotes.userId, userId),
            eq(weeklyNotes.weekStartDate, weekStartDate),
          ),
        )
        .limit(1),
      db
        .select()
        .from(activityDeletions)
        .where(eq(activityDeletions.userId, userId)),
      loadPeriodReviews(userId),
    ]);

  return {
    manualActivities: manualRows.map((row) => ({
      id: row.id,
      startDate: row.startDate,
      details: row.details,
    })),
    activityComments: commentRows.map((row) => ({
      activityId: row.activityId,
      comment: row.comment,
    })),
    weeklyNote: noteRows[0]?.note ?? null,
    periodReviews: reviewEntries.map(({ review, reply }) => ({
      kind: review.kind,
      title: review.title,
      startDate: review.startDate,
      endDate: review.endDate,
      summary: review.summary,
      comment: review.comment,
      reply: reply?.text ?? null,
    })),
    updatedAt: newest([
      ...manualRows,
      ...commentRows,
      ...noteRows,
      ...deletionRows,
      // A generated summary or a dismissal is not athlete input; only a comment
      // should make the plan stale.
      ...reviewEntries
        .filter(({ review }) => review.comment !== null)
        .map(({ review }) => review),
    ]),
  };
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
  input: ManualActivityInput,
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(manualActivities)
    .set({
      startDate: input.startDate,
      details: input.details,
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
 * Records a manual activity. The plan's stored input timestamp is deliberately
 * left unchanged so the next status read sees the newer input and regenerates.
 */
export async function saveManualActivity(
  userId: number,
  input: ManualActivityInput,
): Promise<number> {
  const now = new Date();
  const [row] = await db
    .insert(manualActivities)
    .values({
      userId,
      startDate: input.startDate,
      details: input.details,
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
