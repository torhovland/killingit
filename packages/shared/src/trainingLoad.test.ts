import { describe, expect, it } from "bun:test";
import type { ActivitySample } from "./activity.js";
import {
  bikeWorkoutTrainingStressScore,
  dailyTrainingLoad,
  estimatedTssFromSession,
  interpretTrainingForm,
  normalizedPower,
  powerTrainingStressScore,
  recordedPowerSummary,
  trainingLoadSchema,
} from "./trainingLoad.js";

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
});

describe("normalizedPower", () => {
  it("returns the same value for steady effort", () => {
    expect(
      normalizedPower(samples(Array.from({ length: 120 }, () => 200))),
    ).toBe(200);
  });

  it("rewards surges more than the average power does", () => {
    const steady = normalizedPower(samples(Array(120).fill(200)));
    const surging = normalizedPower(
      samples([
        ...Array.from({ length: 60 }, () => 100),
        ...Array.from({ length: 60 }, () => 300),
      ]),
    );
    expect(steady).toBe(200);
    expect(surging).not.toBeNull();
    expect((surging ?? 0) > 200).toBe(true);
  });

  it("returns null when the activity has no power", () => {
    expect(normalizedPower([{ timestamp: "2026-01-01T08:00:00Z" }])).toBeNull();
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

describe("interpretTrainingForm", () => {
  it("maps TSB as a percentage of CTL to the form zones", () => {
    expect(interpretTrainingForm({ tsb: 21, ctl: 100 })).toBe("detraining");
    expect(interpretTrainingForm({ tsb: 20, ctl: 100 })).toBe("fresh");
    expect(interpretTrainingForm({ tsb: 5, ctl: 100 })).toBe("fresh");
    expect(interpretTrainingForm({ tsb: 4, ctl: 100 })).toBe("maintaining");
    expect(interpretTrainingForm({ tsb: -10, ctl: 100 })).toBe("maintaining");
    expect(interpretTrainingForm({ tsb: -11, ctl: 100 })).toBe("productive");
    expect(interpretTrainingForm({ tsb: -30, ctl: 100 })).toBe("productive");
    expect(interpretTrainingForm({ tsb: -31, ctl: 100 })).toBe("risk");
  });

  it("scales the interpretation with the athlete's fitness", () => {
    expect(interpretTrainingForm({ tsb: -10, ctl: 20 })).toBe("risk");
    expect(interpretTrainingForm({ tsb: -10, ctl: 100 })).toBe("maintaining");
  });

  it("handles a missing fitness base", () => {
    expect(interpretTrainingForm({ tsb: 0, ctl: 0 })).toBe("maintaining");
    expect(interpretTrainingForm({ tsb: 5, ctl: 0 })).toBe("detraining");
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
