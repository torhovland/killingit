import type { ActivityFeed } from "./activities.js";

interface ActiveAnalysis {
  promise: Promise<ActivityFeed>;
}

interface CompletedAnalysis {
  feed: ActivityFeed;
  completedAt: number;
}

/**
 * One activity-analysis pass per account. The map is process-local, like the
 * plan run registry: overlapping dashboard and plan requests on one instance
 * share the same Garmin sync and the same LLM analyses instead of analysing the
 * same activities twice and racing each other's writes.
 */
const activeAnalyses = new Map<number, ActiveAnalysis>();
const completedAnalyses = new Map<number, CompletedAnalysis>();

/**
 * Runs an account's activity analyses once. An ordinary request joins the pass
 * already in flight, so the plan run that overlaps a dashboard reload waits for
 * the analyses and reads the finished feed. An explicit refresh starts its own
 * pass because the athlete asked for fresh analyses.
 */
export function shareActivityAnalysis(
  userId: number,
  refresh: boolean,
  run: () => Promise<ActivityFeed>,
): Promise<ActivityFeed> {
  if (!refresh) {
    const active = activeAnalyses.get(userId);
    if (active !== undefined) {
      return active.promise;
    }
  }

  const entry: ActiveAnalysis = { promise: run() };
  activeAnalyses.set(userId, entry);
  entry.promise.then(
    (feed) => {
      completedAnalyses.set(userId, { feed, completedAt: Date.now() });
      release(userId, entry);
    },
    () => release(userId, entry),
  );
  return entry.promise;
}

/**
 * Returns the account's most recent finished feed, or waits for the pass that
 * is still running. The caller supplies the moment it took its own snapshot so
 * an older completed pass is not mistaken for a newer one.
 */
export async function latestActivityAnalysisSince(
  userId: number,
  since: number,
): Promise<ActivityFeed | null> {
  const active = activeAnalyses.get(userId);
  if (active !== undefined) {
    try {
      return await active.promise;
    } catch {
      return null;
    }
  }

  const completed = completedAnalyses.get(userId);
  return completed !== undefined && completed.completedAt >= since
    ? completed.feed
    : null;
}

function release(userId: number, entry: ActiveAnalysis): void {
  if (activeAnalyses.get(userId) === entry) {
    activeAnalyses.delete(userId);
  }
}
