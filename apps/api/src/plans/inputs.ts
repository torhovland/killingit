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
} from "../llm/planContext.js";
import { startOfWeek } from "./dates.js";

/** Everything the athlete has added on top of their synced training. */
export interface CoachingInputs {
  manualActivities: ManualActivityContext[];
  activityComments: ActivityCommentContext[];
  weeklyNote: string | null;
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
 * recorded activities, activity comments, and the note for `weekStartDate`.
 * The returned `updatedAt` is the newest timestamp across all inputs and drives
 * the plan's automatic revision.
 */
export async function loadCoachingInputs(
  userId: number,
  weekStartDate: string,
): Promise<CoachingInputs> {
  const [manualRows, commentRows, noteRows, deletionRows] = await Promise.all([
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
    updatedAt: newest([
      ...manualRows,
      ...commentRows,
      ...noteRows,
      ...deletionRows,
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

/** Upserts a comment on an activity. The plan's input timestamp stays unchanged. */
export async function saveActivityComment(
  userId: number,
  input: ActivityCommentInput,
): Promise<void> {
  const now = new Date();
  await db
    .insert(activityComments)
    .values({
      userId,
      activityId: input.activityId,
      comment: input.comment,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [activityComments.userId, activityComments.activityId],
      set: { comment: input.comment, updatedAt: now },
    });
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
