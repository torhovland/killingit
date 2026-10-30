import { describe, expect, it } from "bun:test";
import type { Activity, AnalyzedActivity } from "@killingit/shared";
import { mergeActivityHistory } from "./activities.js";

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
