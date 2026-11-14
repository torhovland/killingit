import { describe, expect, it } from "bun:test";
import type { Activity, GarminMetricsResponse } from "@killingit/shared";
import { syncGarminFeed } from "./feedSync.js";

const credentials = { username: "athlete", password: "secret" };
const today = "2026-11-14";

const snapshot: GarminMetricsResponse = {
  metrics: [{ date: "2026-11-13", weightKg: 72.4 }],
  ftp: [],
};

function activity(id: number): Activity {
  return {
    id,
    name: `Ride ${id}`,
    type: "cycling",
    startDate: "2026-11-13T07:00:00Z",
    distance: 30000,
    movingTime: 3600,
    elapsedTime: 3700,
    totalElevationGain: 200,
    samples: [],
  };
}

/** A daily sync result with nothing fetched. */
function dailyResult() {
  return { fetched: [], rateLimited: false, failedDate: null };
}

describe("syncGarminFeed", () => {
  it("syncs activities, metrics and daily health in order", async () => {
    const calls: string[] = [];

    const result = await syncGarminFeed(
      { userId: 7, credentials, today },
      {
        syncActivities: () => {
          calls.push("syncActivities");
          return Promise.resolve([activity(1)]);
        },
        syncMetrics: () => {
          calls.push("syncMetrics");
          return Promise.resolve(snapshot);
        },
        saveMetrics: () => {
          calls.push("saveMetrics");
          return Promise.resolve();
        },
        saveFtp: () => {
          calls.push("saveFtp");
          return Promise.resolve();
        },
        syncDaily: () => {
          calls.push("syncDaily");
          return Promise.resolve(dailyResult());
        },
        loadDeletedIds: () => Promise.resolve(new Set()),
      },
    );

    expect(calls).toEqual([
      "syncActivities",
      "syncMetrics",
      "saveMetrics",
      "saveFtp",
      "syncDaily",
    ]);
    expect(result.activities.map((entry) => entry.id)).toEqual([1]);
    expect(result.deletedIds).toEqual(new Set());
  });

  it("still syncs daily health when the metrics sync fails", async () => {
    const calls: string[] = [];

    const result = await syncGarminFeed(
      { userId: 7, credentials, today },
      {
        syncActivities: () => Promise.resolve([activity(1)]),
        syncMetrics: () => {
          calls.push("syncMetrics");
          return Promise.reject(new Error("body composition outage"));
        },
        syncDaily: () => {
          calls.push("syncDaily");
          return Promise.resolve(dailyResult());
        },
        loadDeletedIds: () => Promise.resolve(new Set()),
      },
    );

    expect(calls).toEqual(["syncMetrics", "syncDaily"]);
    expect(result.activities.map((entry) => entry.id)).toEqual([1]);
  });

  it("returns the activities when the daily health sync fails", async () => {
    const result = await syncGarminFeed(
      { userId: 7, credentials, today },
      {
        syncActivities: () => Promise.resolve([activity(1)]),
        syncMetrics: () => Promise.resolve(snapshot),
        saveMetrics: () => Promise.resolve(),
        saveFtp: () => Promise.resolve(),
        syncDaily: () => Promise.reject(new Error("daily outage")),
        loadDeletedIds: () => Promise.resolve(new Set()),
      },
    );

    expect(result.activities.map((entry) => entry.id)).toEqual([1]);
  });

  it("throws when the activity sync fails and skips the supplements", async () => {
    const calls: string[] = [];
    let failure: unknown = null;

    try {
      await syncGarminFeed(
        { userId: 7, credentials, today },
        {
          syncActivities: () => Promise.reject(new Error("sync outage")),
          syncDaily: () => {
            calls.push("syncDaily");
            return Promise.resolve(dailyResult());
          },
        },
      );
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("sync outage");
    expect(calls).toEqual([]);
  });

  it("drops locally deleted activities and returns their IDs", async () => {
    const result = await syncGarminFeed(
      { userId: 7, credentials, today },
      {
        syncActivities: () => Promise.resolve([activity(1), activity(2)]),
        syncMetrics: () => Promise.resolve(snapshot),
        saveMetrics: () => Promise.resolve(),
        saveFtp: () => Promise.resolve(),
        syncDaily: () => Promise.resolve(dailyResult()),
        loadDeletedIds: () => Promise.resolve(new Set(["1"])),
      },
    );

    expect(result.activities.map((entry) => entry.id)).toEqual([2]);
    expect(result.deletedIds).toEqual(new Set(["1"]));
  });
});
