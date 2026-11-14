import { describe, expect, it, mock } from "bun:test";
import type { Activity, AnalyzedActivity } from "@killingit/shared";
import type { ActivityFeedback } from "../plans/replies.js";
import {
  commentIsNewerThanAnalysis,
  extendStoredFeed,
  mergeActivityHistory,
  withActivityLoad,
  withFeedback,
} from "./activities.js";

type FeedCache = NonNullable<Parameters<typeof extendStoredFeed>[1]>;

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

describe("commentIsNewerThanAnalysis", () => {
  const generatedAt = new Date("2026-10-22T09:00:00Z");

  it("regenerates an analysis older than the comment", () => {
    expect(
      commentIsNewerThanAnalysis(
        { generatedAt },
        new Date("2026-10-22T10:00:00Z"),
      ),
    ).toBe(true);
  });

  it("keeps an analysis produced after the comment", () => {
    expect(
      commentIsNewerThanAnalysis(
        { generatedAt },
        new Date("2026-10-22T08:00:00Z"),
      ),
    ).toBe(false);
  });

  it("keeps an analysis when there is no comment", () => {
    expect(commentIsNewerThanAnalysis({ generatedAt }, null)).toBe(false);
    expect(commentIsNewerThanAnalysis(undefined, new Date())).toBe(false);
  });
});

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

describe("withFeedback", () => {
  const feedback: ActivityFeedback = {
    comment: "Felt strong",
    commentUpdatedAt: new Date("2026-10-03T08:00:00Z"),
    reply: {
      kind: "activity_comment",
      target: "1",
      text: "Good ride",
      model: "test-model",
      generatedAt: new Date("2026-10-03T09:00:00Z"),
      planChangeNeeded: false,
    },
    reviewed: true,
  };

  it("applies the stored comment, reply and reviewed flag", () => {
    const updated = withFeedback(
      stored(1, "2026-10-03T06:30:00Z"),
      new Map([["1", feedback]]),
    );

    expect(updated.comment).toBe("Felt strong");
    expect(updated.coachReply?.text).toBe("Good ride");
    expect(updated.reviewed).toBe(true);
  });

  it("returns the activity unchanged when it has no stored feedback", () => {
    const activity = stored(1, "2026-10-03T06:30:00Z");

    expect(withFeedback(activity, new Map())).toBe(activity);
  });
});

describe("withActivityLoad", () => {
  const loads = {
    byDate: new Map([["2026-10-03", { tss: 85, atl: 29, ctl: 20, tsb: -20 }]]),
    byActivityId: new Map([[1, 40]]),
  };

  it("attaches the activity's own TSS and its day's fitness snapshot", () => {
    const updated = withActivityLoad(
      stored(1, "2026-10-03T06:30:00Z"),
      loads,
      "UTC",
    );

    expect(updated.activityTss).toBe(40);
    expect(updated.trainingLoad?.tss).toBe(85);
  });

  it("keeps an existing activity TSS when the loads do not cover it", () => {
    const activity = {
      ...stored(2, "2026-10-04T06:30:00Z"),
      activityTss: 55,
    };

    const updated = withActivityLoad(activity, loads, "UTC");

    expect(updated.activityTss).toBe(55);
    expect(updated.trainingLoad).toBeNull();
  });
});

describe("extendStoredFeed", () => {
  it("does not store a sync when the stored feed cannot be read", async () => {
    const cache: FeedCache = {
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
        cache,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : "").toBe(
      "The stored activity feed could not be read",
    );
    expect(cache.save).not.toHaveBeenCalled();
  });

  it("stores the merged history when the stored feed can be read", async () => {
    const cache: FeedCache = {
      load: () =>
        Promise.resolve({
          model: null,
          activities: [stored(1, "2026-10-03T06:30:00Z")],
        }),
      save: mock(() => Promise.resolve()),
    };

    const history = await extendStoredFeed(
      {
        userId: 1,
        synced: [synced(2, "2026-10-11T06:30:00Z", "New ride")],
        deletedIds: new Set(),
      },
      cache,
    );

    expect(history.map((activity) => activity.id)).toEqual([2, 1]);
    expect(cache.save).toHaveBeenCalledWith(1, {
      model: null,
      activities: history,
    });
  });
});
