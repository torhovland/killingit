import type { AnalyzedActivitiesResponse } from "@killingit/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { activityFeedCache } from "../db/schema.js";

/**
 * How many of the newest activities one coach analysis or prompt reviews. The
 * stored feed keeps every activity, so this only bounds the model's context.
 */
export const MAX_ANALYZED_ACTIVITIES = 20;

/** Reads the stored feed: every activity ever synced for this account. */
export async function loadCachedActivityFeed(
  userId: number,
): Promise<AnalyzedActivitiesResponse | null> {
  const rows = await db
    .select({ feed: activityFeedCache.feed })
    .from(activityFeedCache)
    .where(eq(activityFeedCache.userId, userId))
    .limit(1);
  return rows[0]?.feed ?? null;
}

/** Stores the feed so the next page load can show it immediately. */
export async function saveCachedActivityFeed(
  userId: number,
  feed: AnalyzedActivitiesResponse,
): Promise<void> {
  const now = new Date();
  await db
    .insert(activityFeedCache)
    .values({ userId, feed, updatedAt: now })
    .onConflictDoUpdate({
      target: activityFeedCache.userId,
      set: { feed, updatedAt: now },
    });
}
