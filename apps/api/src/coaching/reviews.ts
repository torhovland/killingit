import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { activityReviews } from "../db/schema.js";

/**
 * Records that the athlete acknowledged an activity with "No comment". Reviews
 * only affect which activities still need attention; they never make the plan
 * stale or influence training.
 */
export async function saveActivityReview(
  userId: number,
  activityId: string,
): Promise<void> {
  await db
    .insert(activityReviews)
    .values({ userId, activityId })
    .onConflictDoNothing({
      target: [activityReviews.userId, activityReviews.activityId],
    });
}

/** Loads the ids of activities the athlete has already acknowledged. */
export async function loadReviewedActivityIds(
  userId: number,
  activityIds: readonly string[],
): Promise<Set<string>> {
  if (activityIds.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ activityId: activityReviews.activityId })
    .from(activityReviews)
    .where(
      and(
        eq(activityReviews.userId, userId),
        inArray(activityReviews.activityId, [...activityIds]),
      ),
    );
  return new Set(rows.map((row) => row.activityId));
}
