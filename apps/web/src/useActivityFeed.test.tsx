import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnalyzedActivitiesResponse } from "@killingit/shared";
import {
  saveCachedActivities,
  type ActivityCacheStorage,
} from "./activityCache";
import { AppStatusProvider } from "./AppStatus";
import type { AuthState } from "./auth";
import { useActivityFeed } from "./useActivityFeed";

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve(undefined),
};

const feed: AnalyzedActivitiesResponse = {
  model: null,
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
      sampleCount: 0,
      samples: [],
      analysis: null,
      analysisError: null,
      programAnalysis: null,
      comment: null,
      coachReply: null,
    },
  ],
};

function memoryStorage(): ActivityCacheStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function FeedProbe() {
  const feedState = useActivityFeed(auth, "Europe/Oslo");
  return (
    <p>
      {feedState.data?.activities.map((activity) => activity.name).join(",")}
    </p>
  );
}

function render(): string {
  return renderToStaticMarkup(
    <AppStatusProvider>
      <FeedProbe />
    </AppStatusProvider>,
  );
}

describe("useActivityFeed", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("seeds the feed from the account's browser cache", () => {
    const storage = memoryStorage();
    saveCachedActivities("user-1", feed, storage);
    Object.assign(globalThis, { localStorage: storage });

    expect(render()).toContain("Morning Run");
  });

  it("starts empty when the account has no cached feed", () => {
    Object.assign(globalThis, { localStorage: memoryStorage() });

    expect(render()).toContain("<p></p>");
  });
});
