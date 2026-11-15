import { describe, expect, it } from "bun:test";
import type { DailyHealthPoint, FitnessHistoryDay } from "@killingit/shared";
import { prepareDailyHealthCharts, sleepLegendItems } from "./dailyHealthData";

function day(date: string): FitnessHistoryDay {
  return {
    date,
    tss: 0,
    atl: 0,
    ctl: 0,
    tsb: 0,
    activities: [],
    planned: null,
  };
}

const days = [day("2026-10-20"), day("2026-10-21"), day("2026-10-22")];

const recoveryPoints: DailyHealthPoint[] = [
  { metric: "resting_heart_rate", date: "2026-10-20", value: 50 },
  { metric: "resting_heart_rate", date: "2026-10-22", value: 52 },
  { metric: "body_battery_high", date: "2026-10-20", value: 60 },
  { metric: "body_battery_high", date: "2026-10-21", value: 70 },
  { metric: "body_battery_high", date: "2026-10-22", value: 80 },
  { metric: "sleep_score", date: "2026-10-20", value: 80 },
  { metric: "sleep_score", date: "2026-10-21", value: 82 },
  { metric: "sleep_score", date: "2026-10-22", value: 84 },
  { metric: "stress", date: "2026-10-20", value: 30 },
  { metric: "stress", date: "2026-10-21", value: 28 },
  { metric: "stress", date: "2026-10-22", value: 26 },
];

const sleepPoints: DailyHealthPoint[] = [
  { metric: "deep_sleep", date: "2026-10-20", value: 70 },
  { metric: "light_sleep", date: "2026-10-20", value: 200 },
  { metric: "rem_sleep", date: "2026-10-20", value: 90 },
  { metric: "awake_sleep", date: "2026-10-20", value: 10 },
  { metric: "deep_sleep", date: "2026-10-21", value: 75 },
  { metric: "awake_sleep", date: "2026-10-21", value: 12 },
  { metric: "awake_sleep", date: "2026-10-22", value: 8 },
];

describe("prepareDailyHealthCharts", () => {
  it("shapes the resting-heart-rate and score lines over the chart days", () => {
    const data = prepareDailyHealthCharts(days, recoveryPoints);

    expect(data).not.toBeNull();
    const resting = data?.restingHeartRate;
    expect(resting?.series.map((entry) => entry.key)).toEqual([
      "resting_heart_rate",
    ]);
    expect(resting?.series[0]?.values).toEqual([50, null, 52]);
    expect(resting?.series[0]?.format(50)).toBe("50 bpm");
    expect(resting?.series[0]?.label).toBe("Resting heart rate");
    expect(resting?.series[0]?.stroke).toBe("stroke-primary");
    expect(resting?.series[0]?.swatch).toBe("bg-primary");

    const score = data?.score;
    expect(score?.series.map((entry) => entry.key)).toEqual([
      "body_battery_high",
      "sleep_score",
      "stress",
    ]);
    expect(score?.series.map((entry) => entry.values)).toEqual([
      [60, 70, 80],
      [80, 82, 84],
      [30, 28, 26],
    ]);
    expect(score?.series.map((entry) => entry.swatch)).toEqual([
      "bg-form-fresh-line",
      "bg-primary",
      "bg-destructive",
    ]);
    expect(score?.domain).toEqual({ min: 0, max: 100 });
    expect(data?.sleep).toBeNull();
  });

  it("hides a recovery chart whose measure has no values", () => {
    const data = prepareDailyHealthCharts(days, [
      { metric: "stress", date: "2026-10-22", value: 26 },
    ]);

    expect(data?.restingHeartRate).toBeNull();
    // The score chart always carries its three measures; the ones without a
    // value stay in the legend but draw no line.
    expect(data?.score?.series.map((entry) => entry.key)).toEqual([
      "body_battery_high",
      "sleep_score",
      "stress",
    ]);
    expect(data?.score?.series.map((entry) => entry.values)).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, 26],
    ]);
  });

  it("returns nothing when no recovery or sleep measure is stored", () => {
    const data = prepareDailyHealthCharts(days, [
      { metric: "steps", date: "2026-10-22", value: 8200 },
    ]);

    expect(data).toBeNull();
  });

  it("stacks the sleep stages and keeps a missing stage at zero", () => {
    const data = prepareDailyHealthCharts(days, sleepPoints);
    const sleep = data?.sleep;

    expect(sleep?.series.map((entry) => entry.key)).toEqual([
      "deep_sleep",
      "light_sleep",
      "rem_sleep",
    ]);
    expect(sleep?.awake).toEqual([10, 12, 8]);
    // A night with only deep sleep still has a duration, while a night with no
    // sleep stage at all stays blank.
    expect(sleep?.total).toEqual([360, 75, null]);

    const deep = sleep?.layers[0];
    const light = sleep?.layers[1];
    const rem = sleep?.layers[2];
    expect(deep?.top).toEqual([70, 75, null]);
    expect(deep?.bottom).toEqual([0, 0, 0]);
    expect(light?.top).toEqual([270, 75, null]);
    expect(light?.bottom).toEqual([70, 75, null]);
    expect(rem?.top).toEqual([360, 75, null]);
    expect(rem?.bottom).toEqual([270, 75, null]);
    expect(light?.className).toBe(
      "fill-chart-ink-muted/20 stroke-chart-ink-muted",
    );
    expect(sleep?.domain.min).toBe(0);
    expect(sleep?.domain.max).toBeGreaterThanOrEqual(360);
  });

  it("gives the sleep chart an Awake entry with no swatch", () => {
    const data = prepareDailyHealthCharts(days, sleepPoints);
    const sleep = data?.sleep;
    expect(sleep).not.toBeNull();
    if (sleep === null || sleep === undefined) {
      return;
    }

    const legend = sleepLegendItems(sleep);
    expect(legend.map((item) => item.label)).toEqual([
      "Deep sleep",
      "Light sleep",
      "REM sleep",
      "Awake",
    ]);
    expect(legend.slice(0, 3).every((item) => item.swatchShape === "bar")).toBe(
      true,
    );
    expect(legend[3]).toMatchObject({ label: "Awake", swatchShape: "none" });
  });
});
