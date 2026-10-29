import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity } from "@killingit/shared";
import { buildActivityTrainingLoads } from "./activityLoad.js";
import { buildFtpTimelineFromPoints } from "./ftp.js";

const timeline = buildFtpTimelineFromPoints([
  { date: "2026-10-01", value: 250, source: "user" },
]);

function activity(overrides: Partial<AnalyzedActivity> = {}): AnalyzedActivity {
  return {
    id: 1,
    name: "Ride",
    type: "cycling",
    startDate: "2026-10-20T09:00:00Z",
    distance: 30000,
    movingTime: 3600,
    elapsedTime: 3600,
    totalElevationGain: 0,
    sampleCount: 10,
    samples: [],
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}

describe("buildActivityTrainingLoads", () => {
  it("scores a powered activity and gives its day a fitness snapshot", () => {
    const loads = buildActivityTrainingLoads(
      [activity({ normalizedPower: 200 })],
      timeline,
    );
    const day = loads.get("2026-10-20");

    expect(day?.tss).toBe(64);
    expect(day?.atl).toBe(9.1);
    expect(day?.ctl).toBe(1.5);
    expect(day?.tsb).toBe(-7.6);
  });

  it("uses the coach's estimate for an activity without power", () => {
    const loads = buildActivityTrainingLoads(
      [activity()],
      timeline,
      new Map([["2026-10-20", 80]]),
    );
    expect(loads.get("2026-10-20")?.tss).toBe(80);
  });

  it("keeps extra dates (for manual entries) in the series", () => {
    const loads = buildActivityTrainingLoads(
      [activity({ normalizedPower: 200 })],
      timeline,
      new Map(),
      ["2026-10-22"],
    );
    expect(loads.get("2026-10-22")?.tss).toBe(0);
    expect(loads.get("2026-10-22")?.ctl).toBeGreaterThan(0);
  });
});
