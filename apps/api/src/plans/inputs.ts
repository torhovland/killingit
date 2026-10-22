import type {
  ActivityCommentInput,
  ManualActivityInput,
} from "@killingit/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  activityComments,
  coachPlans,
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
  const [manualRows, commentRows, noteRows] = await Promise.all([
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
    updatedAt: newest([...manualRows, ...commentRows, ...noteRows]),
  };
}

/** Records a manual activity and marks the plan for a revision. */
export async function saveManualActivity(
  userId: number,
  input: ManualActivityInput,
): Promise<void> {
  const now = new Date();
  await db.insert(manualActivities).values({
    userId,
    startDate: input.startDate,
    details: input.details,
    createdAt: now,
    updatedAt: now,
  });
  await markInputsUpdated(userId);
}

/** Upserts a comment on an activity and marks the plan for a revision. */
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
  await markInputsUpdated(userId);
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

/** Upserts the note for the week containing `today` and marks the plan dirty. */
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
  await markInputsUpdated(userId);
}

async function markInputsUpdated(userId: number): Promise<void> {
  await db
    .update(coachPlans)
    .set({ coachingInputsUpdatedAt: new Date() })
    .where(eq(coachPlans.userId, userId));
}
