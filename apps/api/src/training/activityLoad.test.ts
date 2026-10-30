import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, AthleteThreshold } from "@killingit/shared";
import {
  buildActivityLoads,
  buildActivityTrainingLoads,
} from "./activityLoad.js";
import { buildThresholdTimelines } from "./thresholds.js";

const cyclingFtp: AthleteThreshold = {
  date: "2026-10-01",
  value: 250,
  source: "user",
  sport: "cycling",
  measure: "ftp",
  label: "FTP",
  unit: "W",
  kind: "power",
};
const timeline = buildThresholdTimelines([cyclingFtp]);

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

  it("splits a day total from the TSS each activity contributed", () => {
    const running = buildThresholdTimelines([
      cyclingFtp,
      {
        date: "2026-10-01",
        value: 220,
        source: "user",
        sport: "running",
        measure: "critical_power",
        label: "Critical power",
        unit: "W",
        kind: "power",
      },
    ]);
    const loads = buildActivityLoads(
      [
        activity({
          id: 1,
          type: "running",
          startDate: "2026-10-28T17:14:23Z",
          movingTime: 1920.311,
          elapsedTime: 1927.662,
          normalizedPower: 255,
        }),
        activity({
          id: 2,
          type: "indoor_rowing",
          startDate: "2026-10-28T17:58:16Z",
          movingTime: 0,
          elapsedTime: 901.861,
          normalizedPower: undefined,
        }),
      ],
      running,
    );

    // The run is scored from its power; the rower falls back to elapsed time.
    expect(loads.byActivityId.get(1)).toBe(72);
    expect(loads.byActivityId.get(2)).toBe(13);
    // The day total is the sum, not either activity's number.
    expect(loads.byDate.get("2026-10-28")?.tss).toBe(85);
  });

  it("splits a coach day estimate across unpowered activities", () => {
    const loads = buildActivityLoads(
      [
        activity({ id: 1, movingTime: 3600, elapsedTime: 3600 }),
        activity({ id: 2, movingTime: 1800, elapsedTime: 1800 }),
      ],
      timeline,
      new Map([["2026-10-20", 90]]),
    );

    expect(loads.byDate.get("2026-10-20")?.tss).toBe(90);
    expect(loads.byActivityId.get(1)).toBe(60);
    expect(loads.byActivityId.get(2)).toBe(30);
  });

  it("scores a run from its sport's threshold pace", () => {
    const running = buildThresholdTimelines([
      {
        date: "2026-10-01",
        value: 300,
        source: "user",
        sport: "running",
        measure: "threshold_pace",
        label: "Threshold pace",
        unit: "s/km",
        kind: "pace",
      },
    ]);
    const loads = buildActivityTrainingLoads(
      [
        activity({
          type: "running",
          distance: 10_000,
          movingTime: 3600,
          elapsedTime: 3600,
        }),
      ],
      running,
    );

    // 10 km/h against a 12 km/h threshold is an intensity factor of 0.833.
    expect(loads.get("2026-10-20")?.tss).toBe(69);
  });

  it("scores an unmeasured activity from its sport's threshold heart rate", () => {
    const running = buildThresholdTimelines([
      {
        date: "2026-10-01",
        value: 165,
        source: "user",
        sport: "running",
        measure: "threshold_heart_rate",
        label: "Threshold heart rate",
        unit: "bpm",
        kind: "heart_rate",
      },
    ]);
    const loads = buildActivityTrainingLoads(
      [
        activity({
          type: "running",
          distance: 0,
          movingTime: 3600,
          elapsedTime: 3600,
          samples: [
            { timestamp: "2026-10-20T09:00:00Z", heartRate: 150 },
            { timestamp: "2026-10-20T10:00:00Z", heartRate: 150 },
          ],
        }),
      ],
      running,
    );

    // One hour at 150 bpm against a 165 bpm threshold.
    expect(loads.get("2026-10-20")?.tss).toBe(83);
  });

  it("falls back to a duration estimate with no threshold for the sport", () => {
    const loads = buildActivityTrainingLoads(
      [
        activity({
          type: "running",
          distance: 0,
          movingTime: 3600,
          elapsedTime: 3600,
        }),
      ],
      timeline,
    );

    expect(loads.get("2026-10-20")?.tss).toBe(65);
  });
});
