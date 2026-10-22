import { describe, expect, it } from "bun:test";
import type { AnalyzedActivitiesResponse } from "@killingit/shared";
import {
  activityCacheKey,
  loadCachedActivities,
  saveCachedActivities,
  type ActivityCacheStorage,
} from "./activityCache";

function memoryStorage(): ActivityCacheStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const feed: AnalyzedActivitiesResponse = {
  model: "openrouter/auto",
  activities: [
    {
      id: 1,
      name: "Morning Run",
      type: "running",
      startDate: "2026-10-01T06:30:00Z",
      distance: 5000,
      movingTime: 1500,
      elapsedTime: 1600,
      totalElevationGain: 55,
      sampleCount: 1,
      analysis: {
        text: "Steady aerobic effort.",
        model: "openrouter/auto",
        generatedAt: "2026-10-01T07:00:00Z",
      },
      analysisError: null,
      programAnalysis: null,
      comment: null,
      coachReply: null,
    },
  ],
};

describe("activityCache", () => {
  it("round-trips the activity feed", () => {
    const storage = memoryStorage();

    saveCachedActivities("user-1", feed, storage);

    expect(loadCachedActivities("user-1", storage)).toEqual(feed);
  });

  it("scopes the cache per account", () => {
    const storage = memoryStorage();

    saveCachedActivities("user-1", feed, storage);

    expect(loadCachedActivities("user-2", storage)).toBeNull();
    expect(storage.values.has(activityCacheKey("user-1"))).toBe(true);
  });

  it("reads a cache written before the account id was known", () => {
    const storage = memoryStorage();

    saveCachedActivities(null, feed, storage);

    expect(loadCachedActivities("user-1", storage)).toEqual(feed);
  });

  it("migrates an anonymous cache to the account key on save", () => {
    const storage = memoryStorage();
    saveCachedActivities(null, feed, storage);

    saveCachedActivities("user-1", feed, storage);

    expect(storage.values.has(activityCacheKey(null))).toBe(false);
    expect(storage.values.has(activityCacheKey("user-1"))).toBe(true);
  });

  it("ignores malformed or outdated cache entries", () => {
    const storage = memoryStorage();

    storage.setItem(activityCacheKey("user-1"), "{not json");
    expect(loadCachedActivities("user-1", storage)).toBeNull();

    storage.setItem(
      activityCacheKey("user-1"),
      JSON.stringify({ model: null, activities: [{ id: "wrong" }] }),
    );
    expect(loadCachedActivities("user-1", storage)).toBeNull();
  });

  it("returns null when storage is unavailable", () => {
    expect(loadCachedActivities("user-1", null)).toBeNull();
    expect(() => saveCachedActivities("user-1", feed, null)).not.toThrow();
  });
});
