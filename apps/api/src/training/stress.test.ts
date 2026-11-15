import { describe, expect, it } from "bun:test";
import { trainingLoadSchema, type ActivitySample } from "@killingit/shared";
import {
  bikeWorkoutTrainingStressScore,
  dailyTrainingLoad,
  estimatedTssFromSession,
  powerTrainingStressScore,
  recordedPowerSummary,
  trainingStressScore,
} from "./stress.js";

function samples(powerBySecond: readonly number[]): ActivitySample[] {
  return powerBySecond.map((power, second) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 8, 0, second)).toISOString(),
    power,
  }));
}

describe("powerTrainingStressScore", () => {
  it("scores an hour at FTP as 100", () => {
    expect(
      powerTrainingStressScore({
        durationSeconds: 3600,
        normalizedPowerWatts: 250,
        ftpWatts: 250,
      }),
    ).toBe(100);
  });

  it("scales with the square of the intensity factor", () => {
    expect(
      powerTrainingStressScore({
        durationSeconds: 3600,
        normalizedPowerWatts: 175,
        ftpWatts: 250,
      }),
    ).toBe(49);
  });

  it("rounds the unrounded score at the caller", () => {
    // 1000 seconds at FTP is 27.78 before rounding.
    expect(
      powerTrainingStressScore({
        durationSeconds: 1000,
        normalizedPowerWatts: 250,
        ftpWatts: 250,
      }),
    ).toBe(28);
  });

  it("returns null without usable power or FTP", () => {
    expect(
      powerTrainingStressScore({
        durationSeconds: 0,
        normalizedPowerWatts: 200,
        ftpWatts: 250,
      }),
    ).toBeNull();
    expect(
      powerTrainingStressScore({
        durationSeconds: 3600,
        normalizedPowerWatts: 0,
        ftpWatts: 250,
      }),
    ).toBeNull();
  });
});

describe("trainingStressScore", () => {
  it("returns the unrounded score for hours at an intensity factor", () => {
    expect(trainingStressScore(1, 1)).toBe(100);
    expect(trainingStressScore(1000 / 3600, 1)).toBeCloseTo(27.78, 2);
  });
});

describe("bikeWorkoutTrainingStressScore", () => {
  it("scores steady intervals from their percentage of FTP", () => {
    expect(
      bikeWorkoutTrainingStressScore({
        ftpWatts: 250,
        intervals: [
          { durationSeconds: 300, powerPercent: 50 },
          { durationSeconds: 3600, powerPercent: 100 },
        ],
      }),
    ).toBe(102);
  });

  it("rounds once after summing the unrounded intervals", () => {
    // Four 30-second blocks at FTP: 3.33 in total, not 4 from rounding each.
    expect(
      bikeWorkoutTrainingStressScore({
        ftpWatts: 250,
        intervals: Array.from({ length: 4 }, () => ({
          durationSeconds: 30,
          powerPercent: 100,
        })),
      }),
    ).toBe(3);
  });
});

describe("recordedPowerSummary", () => {
  it("returns the same normalized power for steady effort", () => {
    expect(
      recordedPowerSummary(samples(Array.from({ length: 120 }, () => 200)))
        .normalizedPower,
    ).toBe(200);
  });

  it("rewards surges more than the average power does", () => {
    const steady = recordedPowerSummary(samples(Array(120).fill(200)));
    const surging = recordedPowerSummary(
      samples([
        ...Array.from({ length: 60 }, () => 100),
        ...Array.from({ length: 60 }, () => 300),
      ]),
    );
    expect(steady.normalizedPower).toBe(200);
    expect(surging.normalizedPower).not.toBeNull();
    expect((surging.normalizedPower ?? 0) > 200).toBe(true);
  });

  it("returns nulls when the activity has no power", () => {
    expect(
      recordedPowerSummary([{ timestamp: "2026-01-01T08:00:00Z" }])
        .normalizedPower,
    ).toBeNull();
  });

  it("summarizes average and normalized power together", () => {
    const summary = recordedPowerSummary(
      samples(Array.from({ length: 60 }, () => 180)),
    );
    expect(summary.averagePower).toBe(180);
    expect(summary.normalizedPower).toBe(180);
    expect(recordedPowerSummary([])).toEqual({
      averagePower: null,
      normalizedPower: null,
    });
  });
});

describe("dailyTrainingLoad", () => {
  it("moves ATL faster than CTL and reports form as their difference", () => {
    const series = dailyTrainingLoad({
      startDate: "2026-01-01",
      endDate: "2026-01-08",
      tssByDate: new Map([["2026-01-01", 100]]),
    });

    const first = series.get("2026-01-01");
    const second = series.get("2026-01-02");
    expect(first?.atl).toBeCloseTo(14.3, 1);
    expect(first?.ctl).toBeCloseTo(2.4, 1);
    expect(first?.tsb).toBeCloseTo(-11.9, 1);
    expect(second?.atl).toBeCloseTo(12.2, 1);
    expect(second?.ctl).toBeCloseTo(2.3, 1);
    expect(second?.tsb).toBeGreaterThan(first?.tsb ?? 0);
  });

  it("treats missing days as rest", () => {
    const series = dailyTrainingLoad({
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      tssByDate: new Map(),
    });
    expect(series.get("2026-01-01")).toEqual({
      tss: 0,
      atl: 0,
      ctl: 0,
      tsb: 0,
    });
  });

  it("produces valid training-load objects", () => {
    const series = dailyTrainingLoad({
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      tssByDate: new Map([["2026-01-01", 80]]),
    });
    expect(trainingLoadSchema.safeParse(series.get("2026-01-01")).success).toBe(
      true,
    );
  });
});

describe("estimatedTssFromSession", () => {
  it("scales with duration and intensity", () => {
    expect(
      estimatedTssFromSession({
        type: "workout",
        durationMinutes: 60,
        intensity: "moderate",
      }),
    ).toBe(60);
    expect(
      estimatedTssFromSession({
        type: "rest",
        durationMinutes: 0,
        intensity: "rest",
      }),
    ).toBe(0);
  });
});
