import { describe, expect, it } from "bun:test";
import type { FitnessDietTarget } from "@killingit/shared";
import { axisTicks } from "../../charts/chartGeometry";
import {
  bodyLegendItems,
  bodyValuesAt,
  prepareBodyChart,
} from "./bodyChartData";

const days = [
  { date: "2026-10-20" },
  { date: "2026-10-21" },
  { date: "2026-10-22" },
];
const weight = [
  { date: "2026-10-20", value: 82 },
  { date: "2026-10-21", value: 81.8 },
  { date: "2026-10-22", value: 81.5 },
];
const bodyFat = [
  { date: "2026-10-20", value: 19 },
  { date: "2026-10-21", value: 18.9 },
  { date: "2026-10-22", value: 18.8 },
];
const dietTargets: FitnessDietTarget[] = [
  { date: "2026-11-01", weightKg: 80, bodyFatPercent: 18 },
  { date: "2026-12-01", weightKg: 78, bodyFatPercent: 16 },
];

function prepare(
  overrides: Partial<Parameters<typeof prepareBodyChart>[0]> = {},
) {
  return prepareBodyChart({
    days,
    weight,
    bodyFat,
    today: "2026-10-22",
    seasonEndDate: "2026-12-31",
    dietTargets,
    ...overrides,
  });
}

describe("prepareBodyChart", () => {
  it("prepares one scale per measure and puts weight on the left axis", () => {
    const data = prepare();
    expect(data).not.toBeNull();
    if (data === null) {
      return;
    }
    if (data.weight === null || data.bodyFat === null) {
      throw new Error("expected both body series");
    }

    expect(data.weight.domain.min).toBeLessThan(81.5);
    expect(data.weight.domain.max).toBeGreaterThan(82);
    expect(data.bodyFat.domain.min).toBeLessThan(18.8);
    expect(data.bodyFat.domain.max).toBeGreaterThan(19);
    expect(data.yScale).toBe(data.weight.scale);
    expect(data.ticks).toEqual(axisTicks(data.weight.domain));
    expect(data.gridTicks).toEqual(data.ticks);
    expect(data.rightTicks).toEqual(axisTicks(data.bodyFat.domain));
    expect(data.chartDays).toEqual(days);
    expect(data.split).toBe(2);
    expect(data.canShowFuture).toBe(true);
    expect(data.weightTargets).toEqual([]);
    expect(data.fatTargets).toEqual([]);
  });

  it("extends the chart and draws the diet targets in the season view", () => {
    const data = prepare({ showFuture: true });
    expect(data).not.toBeNull();
    if (data === null) {
      return;
    }

    expect(data.chartDays[0]).toEqual(days[0]);
    expect(data.chartDays[data.chartDays.length - 1]?.date).toBe("2026-12-31");
    expect(data.weightTargets[0]).toEqual({ date: "2026-10-22", value: 81.5 });
    expect(data.fatTargets[0]).toEqual({ date: "2026-10-22", value: 18.8 });
    expect(data.weightTargets.at(-1)).toEqual({
      date: "2026-12-01",
      value: 78,
    });
    expect(bodyValuesAt(data, "2026-11-01")).toEqual({
      weight: null,
      fat: null,
      targetWeight: 80,
      targetFat: 18,
    });
    expect(bodyLegendItems(data).map((item) => item.label)).toEqual([
      "Weight (kg)",
      "Body fat (%)",
      "Estimated diet progress",
    ]);
  });

  it("draws only weight and its left ticks when body fat is missing", () => {
    const data = prepare({ bodyFat: [], showFuture: true });
    expect(data).not.toBeNull();
    if (data === null) {
      return;
    }

    expect(data.weight).not.toBeNull();
    expect(data.bodyFat).toBeNull();
    if (data.weight === null) {
      throw new Error("expected weight series");
    }
    expect(data.yScale).toBe(data.weight.scale);
    expect(data.ticks.length).toBeGreaterThan(0);
    expect(data.gridTicks).toEqual(data.ticks);
    expect(data.rightTicks).toBeUndefined();
    expect(data.fatTargets).toEqual([]);
    expect(bodyLegendItems(data).map((item) => item.label)).toEqual([
      "Weight (kg)",
      "Estimated diet progress",
    ]);
  });

  it("keeps grid lines from body fat when weight is missing", () => {
    const data = prepare({ weight: [] });
    expect(data).not.toBeNull();
    if (data === null) {
      return;
    }

    expect(data.weight).toBeNull();
    expect(data.bodyFat).not.toBeNull();
    if (data.bodyFat === null) {
      throw new Error("expected body-fat series");
    }
    expect(data.yScale).toBe(data.bodyFat.scale);
    expect(data.ticks).toEqual([]);
    expect(data.gridTicks).toEqual(axisTicks(data.bodyFat.domain));
    expect(data.rightTicks).not.toBeUndefined();
    expect(bodyLegendItems(data).map((item) => item.label)).toEqual([
      "Body fat (%)",
    ]);
  });

  it("does not offer the season view without a future target", () => {
    const data = prepare({ dietTargets: [], showFuture: true });
    expect(data?.canShowFuture).toBe(false);
    expect(data?.chartDays).toEqual(days);
  });

  it("does not offer the season view when the season ends today", () => {
    const data = prepare({ seasonEndDate: "2026-10-22", showFuture: true });
    expect(data?.canShowFuture).toBe(false);
  });

  it("returns nothing without measurements", () => {
    expect(prepare({ weight: [], bodyFat: [] })).toBeNull();
  });
});

describe("bodyValuesAt", () => {
  it("reads the measured values on a day and leaves absent ones null", () => {
    const data = prepare();
    expect(data).not.toBeNull();
    if (data === null) {
      return;
    }

    expect(bodyValuesAt(data, "2026-10-21")).toEqual({
      weight: 81.8,
      fat: 18.9,
      targetWeight: null,
      targetFat: null,
    });
    expect(bodyValuesAt(data, null)).toEqual({
      weight: null,
      fat: null,
      targetWeight: null,
      targetFat: null,
    });
    expect(bodyValuesAt(data, "2026-10-19")).toEqual({
      weight: null,
      fat: null,
      targetWeight: null,
      targetFat: null,
    });
  });
});
