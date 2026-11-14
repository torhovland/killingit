import { describe, expect, it, mock } from "bun:test";
import type { Activity, AnalyzedActivity } from "@killingit/shared";
import { extendStoredFeed, mergeActivityHistory } from "./sync.js";

type ActivityStore = NonNullable<Parameters<typeof extendStoredFeed>[1]>;

function synced(id: number, startDate: string, name: string): Activity {
  return {
    id,
    name,
    type: "cycling",
    startDate,
    distance: 10000,
    movingTime: 1800,
    elapsedTime: 1900,
    totalElevationGain: 100,
    samples: [],
  };
}

function stored(id: number, startDate: string): AnalyzedActivity {
  return {
    ...synced(id, startDate, `Old ${id}`),
    sampleCount: 0,
    analysis: {
      text: `Analysis ${id}`,
      model: "test-model",
      generatedAt: "2026-10-01T07:00:00Z",
    },
    analysisError: null,
    programAnalysis: null,
    comment: `Comment ${id}`,
    coachReply: null,
  };
}

describe("mergeActivityHistory", () => {
  it("keeps activities that fell outside the latest sync window", () => {
    const merged = mergeActivityHistory(
      [stored(1, "2026-10-03T06:30:00Z")],
      [synced(2, "2026-10-11T06:30:00Z", "New ride")],
    );

    expect(merged.map((activity) => activity.id)).toEqual([2, 1]);
  });

  it("omits a locally deleted activity from both history and a fresh sync", () => {
    const merged = mergeActivityHistory(
      [stored(1, "2026-10-03T06:30:00Z")],
      [
        synced(1, "2026-10-03T06:30:00Z", "Still on Garmin"),
        synced(2, "2026-10-11T06:30:00Z", "New ride"),
      ],
      new Set(["1"]),
    );

    expect(merged.map((activity) => activity.id)).toEqual([2]);
  });

  it("updates a synced activity without losing its analysis or feedback", () => {
    const merged = mergeActivityHistory(
      [stored(1, "2026-10-03T06:30:00Z")],
      [synced(1, "2026-10-03T06:30:00Z", "Renamed ride")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Renamed ride");
    expect(merged[0]?.analysis?.text).toBe("Analysis 1");
    expect(merged[0]?.comment).toBe("Comment 1");
  });
});

describe("extendStoredFeed", () => {
  it("does not store a sync when the stored feed cannot be read", async () => {
    const store: ActivityStore = {
      load: () => Promise.reject(new Error("connection reset")),
      save: mock(() => Promise.resolve()),
    };

    let caught: unknown;
    try {
      await extendStoredFeed(
        {
          userId: 1,
          synced: [synced(2, "2026-10-11T06:30:00Z", "New ride")],
          deletedIds: new Set(),
        },
        store,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : "").toBe(
      "The stored activity feed could not be read",
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it("stores only the synced window when the stored feed can be read", async () => {
    const store: ActivityStore = {
      load: () =>
        Promise.resolve({
          model: null,
          activities: [stored(1, "2026-10-03T06:30:00Z")],
        }),
      save: mock(() => Promise.resolve()),
    };
    const deletedIds = new Set(["3"]);

    const history = await extendStoredFeed(
      {
        userId: 1,
        synced: [synced(2, "2026-10-11T06:30:00Z", "New ride")],
        deletedIds,
      },
      store,
    );

    expect(history.map((activity) => activity.id)).toEqual([2, 1]);
    expect(store.save).toHaveBeenCalledWith(
      1,
      [synced(2, "2026-10-11T06:30:00Z", "New ride")],
      deletedIds,
    );
  });
});
