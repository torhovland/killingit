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
