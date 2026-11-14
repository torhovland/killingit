import type { ActivityFeed } from "./activities.js";
import { BoundedMap } from "../lib/boundedMap.js";

interface ActiveAnalysis {
  /** The athlete's local day this pass is computed for. */
  today: string;
  promise: Promise<ActivityFeed>;
}

interface CompletedAnalysis {
  /** The athlete's local day the finished feed was computed for. */
  today: string;
  feed: ActivityFeed;
  completedAt: number;
}

/**
 * Accounts whose finished feed is kept. Each feed carries every analysed
 * activity and its sample previews, so only the most recently used accounts
 * are retained instead of every account that ever visited.
 */
export const MAX_COMPLETED_ANALYSES = 32;

/**
 * One activity-analysis pass per account. The map is process-local, like the
 * plan run registry: overlapping dashboard and plan requests on one instance
 * share the same Garmin sync and the same LLM analyses instead of analysing the
 * same activities twice and racing each other's writes. A pass records the
 * athlete's day as well, because its analyses include that day's plan fit.
 * An entry is removed when its pass settles, so the map holds only live passes.
 */
const activeAnalyses = new Map<number, ActiveAnalysis>();

/**
 * The latest finished feed per account. A read through
 * `latestActivityAnalysisSince` makes that account the most recently used, and
 * an insert beyond {@link MAX_COMPLETED_ANALYSES} evicts the least recently
 * used account. An evicted account simply analyses again on its next request;
 * a kept account still returns the feed only for the day it was computed for.
 * Process-local: another instance may run its own pass.
 */
const completedAnalyses = new BoundedMap<number, CompletedAnalysis>(
  MAX_COMPLETED_ANALYSES,
);

/**
 * Runs an account's activity analyses one pass at a time. An ordinary request
 * joins the pass in flight when it is for the same day. An explicit refresh, or
 * a request for another day, waits for that pass to settle and then starts its
 * own, so two passes never write the same analyses at once.
 */
export function shareActivityAnalysis(
  userId: number,
  today: string,
  refresh: boolean,
  run: () => Promise<ActivityFeed>,
): Promise<ActivityFeed> {
  const active = activeAnalyses.get(userId);
  if (active === undefined) {
    return startAnalysis(userId, today, run);
  }
  if (!refresh && active.today === today) {
    return active.promise;
  }
  // Retry after the running pass settles. Another waiting caller may have
  // started the pass this one would run, so the retry checks the registry
  // again instead of starting beside it.
  return active.promise.then(
    () => shareActivityAnalysis(userId, today, refresh, run),
    () => shareActivityAnalysis(userId, today, refresh, run),
  );
}

/**
 * Returns the account's most recent finished feed for the caller's day, or
 * waits for a pass for that day that is still running. The caller supplies the
 * moment it took its own snapshot so an older completed pass is not mistaken
 * for a newer one.
 */
export async function latestActivityAnalysisSince(
  userId: number,
  today: string,
  since: number,
): Promise<ActivityFeed | null> {
  const active = activeAnalyses.get(userId);
  if (active !== undefined && active.today === today) {
    try {
      return await active.promise;
    } catch {
      return null;
    }
  }

  const completed = completedAnalyses.get(userId);
  return completed !== undefined &&
    completed.today === today &&
    completed.completedAt >= since
    ? completed.feed
    : null;
}

function startAnalysis(
  userId: number,
  today: string,
  run: () => Promise<ActivityFeed>,
): Promise<ActivityFeed> {
  const entry: ActiveAnalysis = { today, promise: run() };
  activeAnalyses.set(userId, entry);
  entry.promise.then(
    (feed) => {
      // One finished feed per account is enough: it is only reused for its own
      // day, and keeping an older day's full history would grow without bound.
      // The bounded map keeps the newest accounts and evicts the rest.
      completedAnalyses.set(userId, {
        today,
        feed,
        completedAt: Date.now(),
      });
      release(userId, entry);
    },
    () => release(userId, entry),
  );
  return entry.promise;
}

function release(userId: number, entry: ActiveAnalysis): void {
  if (activeAnalyses.get(userId) === entry) {
    activeAnalyses.delete(userId);
  }
}
