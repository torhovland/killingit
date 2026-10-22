import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  activityComments,
  activityDeletions,
  coachReplies,
  manualActivities,
} from "../db/schema.js";

/** Where a deleted activity came from. Mirrors `activity_deletions.source`. */
export type ActivitySource = "garmin" | "manual";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Hides a synced Garmin activity from the athlete's coaching view. The activity
 * still exists in Garmin Connect; the next sync simply filters it out.
 */
export async function deleteImportedActivity(
  userId: number,
  activityId: string,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(activityDeletions)
      .values({
        userId,
        source: "garmin",
        activityId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          activityDeletions.userId,
          activityDeletions.source,
          activityDeletions.activityId,
        ],
      });
    await deleteSyncedActivityFeedback(tx, userId, activityId);
  });
}

/**
 * Deletes a manual activity and its coach feedback. Returns false when the
 * activity does not belong to the user.
 */
export async function deleteManualActivity(
  userId: number,
  activityId: number,
): Promise<boolean> {
  const activityIdText = String(activityId);
  const now = new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(manualActivities)
      .where(
        and(
          eq(manualActivities.userId, userId),
          eq(manualActivities.id, activityId),
        ),
      )
      .returning({ id: manualActivities.id });
    if (rows.length === 0) {
      return false;
    }

    await tx.insert(activityDeletions).values({
      userId,
      source: "manual",
      activityId: activityIdText,
      createdAt: now,
      updatedAt: now,
    });
    await deleteManualActivityFeedback(tx, userId, activityIdText);
    return true;
  });
}

/** The imported activity ids the athlete has deleted. */
export async function loadDeletedActivityIds(
  userId: number,
  source: ActivitySource,
): Promise<Set<string>> {
  const rows = await db
    .select({ activityId: activityDeletions.activityId })
    .from(activityDeletions)
    .where(
      and(
        eq(activityDeletions.userId, userId),
        eq(activityDeletions.source, source),
      ),
    );
  return new Set(rows.map((row) => row.activityId));
}

async function deleteSyncedActivityFeedback(
  tx: DbTransaction,
  userId: number,
  activityId: string,
): Promise<void> {
  await Promise.all([
    tx
      .delete(activityComments)
      .where(
        and(
          eq(activityComments.userId, userId),
          eq(activityComments.activityId, activityId),
        ),
      ),
    tx
      .delete(coachReplies)
      .where(
        and(
          eq(coachReplies.userId, userId),
          eq(coachReplies.kind, "activity_comment"),
          eq(coachReplies.target, activityId),
        ),
      ),
  ]);
}

async function deleteManualActivityFeedback(
  tx: DbTransaction,
  userId: number,
  activityId: string,
): Promise<void> {
  await Promise.all([
    tx
      .delete(activityComments)
      .where(
        and(
          eq(activityComments.userId, userId),
          eq(activityComments.activityId, activityId),
        ),
      ),
    tx
      .delete(coachReplies)
      .where(
        and(
          eq(coachReplies.userId, userId),
          inArray(coachReplies.kind, ["activity_comment", "manual_activity"]),
          eq(coachReplies.target, activityId),
        ),
      ),
  ]);
}
