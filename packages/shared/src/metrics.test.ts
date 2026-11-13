import { describe, expect, it } from "bun:test";
import {
  activitySport,
  formatThresholdNumber,
  formatThresholdValue,
  interpolateMetricSeries,
  sessionSports,
} from "./metrics.js";

describe("activitySport", () => {
  it("maps session words for cycling to the cycling key", () => {
    expect(activitySport("Easy indoor ride")).toBe("cycling");
    expect(activitySport("Indoor ERG steady endurance ride")).toBe("cycling");
    expect(activitySport("Easy trainer ride")).toBe("cycling");
    expect(activitySport("Easy indoor spin")).toBe("cycling");
  });
});

describe("sessionSports", () => {
  it("finds every sport a session names", () => {
    expect(sessionSports("Run/walk 3.5 min jogs + Z2 ride")).toEqual([
      "running",
      "cycling",
    ]);
    expect(sessionSports("Gym strength and beginner rowing")).toEqual([
      "strength",
      "rowing",
    ]);
  });

  it("returns an unmatched word when the session names no sport", () => {
    expect(sessionSports("Vault technique & plyo intro")).toEqual([
      "vault",
      "plyo",
    ]);
  });
});

describe("formatThresholdNumber", () => {
  it("drops the unit and keeps a pace as minutes and seconds", () => {
    expect(formatThresholdNumber(250, "W", "power")).toBe("250");
    expect(formatThresholdNumber(18.44, "%", "other")).toBe("18.4");
    expect(formatThresholdNumber(270, "s/km", "pace")).toBe("4:30");
  });
});

describe("formatThresholdValue", () => {
  it("puts the unit after the value", () => {
    expect(formatThresholdValue(250, "W", "power")).toBe("250 W");
    expect(formatThresholdValue(164, "bpm", "heart_rate")).toBe("164 bpm");
    expect(formatThresholdValue(270, "s/km", "pace")).toBe("4:30 /km");
  });
});

describe("interpolateMetricSeries", () => {
  it("interpolates linearly between known values and keeps exact points", () => {
    const series = interpolateMetricSeries(
      [
        { date: "2026-10-01", value: 80 },
        { date: "2026-10-11", value: 78 },
      ],
      "2026-10-01",
      "2026-10-11",
    );

    expect(series).toHaveLength(11);
    expect(series[0]).toEqual({ date: "2026-10-01", value: 80 });
    expect(series[5]).toEqual({ date: "2026-10-06", value: 79 });
    expect(series.at(-1)).toEqual({ date: "2026-10-11", value: 78 });
  });

  it("extrapolates after the last point with the best-fit slope", () => {
    const series = interpolateMetricSeries(
      [
        { date: "2026-10-01", value: 80 },
        { date: "2026-10-03", value: 79 },
        { date: "2026-10-05", value: 78.5 },
      ],
      "2026-10-01",
      "2026-10-10",
    );

    // The three points fit a slope of -0.375 kg/day; the line is anchored at
    // the last measured value, so day 10 is 78.5 - 5 * 0.375.
    expect(series.at(-1)).toEqual({ date: "2026-10-10", value: 76.6 });
  });

  it("starts at the first known point and omits earlier days", () => {
    const series = interpolateMetricSeries(
      [{ date: "2026-10-05", value: 18 }],
      "2026-10-01",
      "2026-10-07",
    );

    expect(series[0]).toEqual({ date: "2026-10-05", value: 18 });
    expect(series).toHaveLength(3);
    // A single measurement has no trend, so the projection stays flat.
    expect(series.at(-1)).toEqual({ date: "2026-10-07", value: 18 });
  });

  it("projects flatly when every measurement is the same", () => {
    const series = interpolateMetricSeries(
      [
        { date: "2026-10-01", value: 80 },
        { date: "2026-10-05", value: 80 },
      ],
      "2026-10-01",
      "2026-10-07",
    );

    expect(series.at(-1)).toEqual({ date: "2026-10-07", value: 80 });
  });

  it("returns an empty series without measurements", () => {
    expect(interpolateMetricSeries([], "2026-10-01", "2026-10-07")).toEqual([]);
  });
});
