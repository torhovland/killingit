import { describe, expect, it } from "bun:test";
import { bestFitSlope, interpolateMetricSeries } from "./metrics.js";

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
  });

  it("returns an empty series without measurements", () => {
    expect(interpolateMetricSeries([], "2026-10-01", "2026-10-07")).toEqual([]);
  });
});

describe("bestFitSlope", () => {
  it("is zero for one point and for a flat series", () => {
    expect(bestFitSlope([{ date: "2026-10-01", value: 80 }])).toBe(0);
    expect(
      bestFitSlope([
        { date: "2026-10-01", value: 80 },
        { date: "2026-10-05", value: 80 },
      ]),
    ).toBe(0);
  });
});
