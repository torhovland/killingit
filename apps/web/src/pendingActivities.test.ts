import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity } from "@killingit/shared";
import { selectPendingActivities } from "./pendingActivities";

function activity(overrides: Partial<AnalyzedActivity> = {}): AnalyzedActivity {
  return {
    id: 1,
    name: "Morning Run",
    type: "running",
    startDate: "2026-10-21T06:30:00Z",
    distance: 5000,
    movingTime: 1500,
    elapsedTime: 1600,
    totalElevationGain: 20,
    sampleCount: 0,
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}

describe("selectPendingActivities", () => {
  it("keeps activities without a comment and not dismissed", () => {
    expect(selectPendingActivities([activity()])).toHaveLength(1);
  });

  it("drops commented and dismissed activities after a reload", () => {
    const activities = [
      activity({ id: 1, comment: "Felt strong." }),
      activity({ id: 2, reviewed: true }),
    ];
    expect(selectPendingActivities(activities)).toEqual([]);
  });

  it("keeps an activity commented on during this visit", () => {
    const commented = activity({ id: 7, comment: "Felt strong." });
    expect(selectPendingActivities([commented], new Set(["7"]))).toHaveLength(
      1,
    );
  });
});
