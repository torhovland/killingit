import {
  analyzedActivitiesResponseSchema,
  type AnalyzedActivitiesResponse,
} from "@killingit/shared";

const CACHE_KEY_PREFIX = "killingit.activities.v1";

/** The subset of `Storage` used by the cache; injectable for tests. */
export interface ActivityCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Cache key scoped to the signed-in account so users cannot see each other. */
export function activityCacheKey(sub: string | null | undefined): string {
  return `${CACHE_KEY_PREFIX}:${sub ?? "anonymous"}`;
}

const ANONYMOUS_KEY = activityCacheKey(null);

function browserStorage(): ActivityCacheStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Browsers can throw when storage is disabled (private mode, policy).
    return null;
  }
}

/**
 * Reads the last successfully loaded activity feed so the dashboard can show
 * existing cards immediately while Garmin syncs and the coach analyses.
 * Malformed, outdated, or unknown-account entries are ignored.
 */
export function loadCachedActivities(
  sub: string | null | undefined,
  storage: ActivityCacheStorage | null = browserStorage(),
): AnalyzedActivitiesResponse | null {
  if (!storage) {
    return null;
  }

  const key = activityCacheKey(sub);
  const cached = readFeed(storage, key);
  if (cached !== null || key === ANONYMOUS_KEY) {
    return cached;
  }

  // A load that raced Auth0's user lookup may have cached the feed before
  // `sub` was available. Use it once, then the next save migrates it to the
  // account-scoped key.
  return readFeed(storage, ANONYMOUS_KEY);
}

function readFeed(
  storage: ActivityCacheStorage,
  key: string,
): AnalyzedActivitiesResponse | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = analyzedActivitiesResponseSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Saves the last successfully loaded activity feed for the next page load. */
export function saveCachedActivities(
  sub: string | null | undefined,
  feed: AnalyzedActivitiesResponse,
  storage: ActivityCacheStorage | null = browserStorage(),
): void {
  if (!storage) {
    return;
  }
  try {
    const key = activityCacheKey(sub);
    storage.setItem(key, JSON.stringify(feed));
    if (key !== ANONYMOUS_KEY) {
      // Remove a cache written before the account id was known; it now lives
      // under the account-scoped key.
      storage.removeItem(ANONYMOUS_KEY);
    }
  } catch {
    // A full or disabled storage must not break the dashboard.
  }
}
