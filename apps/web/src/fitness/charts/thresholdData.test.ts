import { describe, expect, it } from "bun:test";
import type { ThresholdHistorySeries } from "@killingit/shared";
import { prepareThresholdSeries } from "./thresholdData";

const days = [
  { date: "2026-10-20" },
  { date: "2026-10-21" },
  { date: "2026-10-22" },
];

const ftpSeries: ThresholdHistorySeries = {
  sport: "cycling",
  measure: "ftp",
  label: "FTP",
  unit: "W",
  kind: "power",
  points: [
    { date: "2026-10-20", value: 250 },
    { date: "2026-10-22", value: 252 },
  ],
};

const heartRateSeries: ThresholdHistorySeries = {
  sport: "cycling",
  measure: "threshold_heart_rate",
  label: "Threshold heart rate",
  unit: "bpm",
  kind: "heart_rate",
  points: days.map((day, index) => ({ date: day.date, value: 160 + index })),
};

describe("prepareThresholdSeries", () => {
  it("aligns each series with the chart days, leaving a gap as null", () => {
    const prepared = prepareThresholdSeries(days, [ftpSeries, heartRateSeries]);

    expect(prepared.map((line) => line.series.measure)).toEqual([
      "ftp",
      "threshold_heart_rate",
    ]);
    expect(prepared.map((line) => line.values)).toEqual([
      [250, null, 252],
      [160, 161, 162],
    ]);
  });

  it("indexes the same values by date for the hover card", () => {
    const prepared = prepareThresholdSeries(days, [ftpSeries]);
    const ftp = prepared[0];

    expect(ftp?.byDate.get("2026-10-20")).toBe(250);
    expect(ftp?.byDate.get("2026-10-21")).toBeUndefined();
    expect(ftp?.byDate.get("2026-10-22")).toBe(252);
    // The line and the card read the same lookup.
    expect(ftp?.values[2]).toBe(ftp?.byDate.get("2026-10-22"));
  });

  it("keeps a stored point outside the chart days out of the line", () => {
    const prepared = prepareThresholdSeries(days, [
      {
        ...ftpSeries,
        points: [{ date: "2026-09-01", value: 240 }, ...ftpSeries.points],
      },
    ]);

    expect(prepared[0]?.values).toEqual([250, null, 252]);
  });

  it("returns no lines for no series", () => {
    expect(prepareThresholdSeries(days, [])).toEqual([]);
  });
});
