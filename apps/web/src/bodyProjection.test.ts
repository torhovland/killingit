import { describe, expect, it } from "bun:test";
import type { FitnessDietTarget } from "@killingit/shared";
import {
  datesAfter,
  dietTargetSeries,
  dietTargetValueAt,
  lastPointOnOrBefore,
} from "./bodyProjection";

const targets: FitnessDietTarget[] = [
  { date: "2026-11-01", weightKg: 80, bodyFatPercent: 18 },
  { date: "2026-12-01", weightKg: 78, bodyFatPercent: null },
  { date: "2027-01-01", weightKg: null, bodyFatPercent: 15 },
];

describe("lastPointOnOrBefore", () => {
  it("returns the latest point that is not after the date", () => {
    const points = [
      { date: "2026-10-20", value: 82 },
      { date: "2026-10-21", value: 81.5 },
      { date: "2026-10-22", value: 81 },
    ];
    expect(lastPointOnOrBefore(points, "2026-10-21")?.value).toBe(81.5);
    expect(lastPointOnOrBefore(points, "2026-10-25")?.value).toBe(81);
    expect(lastPointOnOrBefore(points, "2026-10-19")).toBeNull();
  });
});

describe("dietTargetSeries", () => {
  it("starts at today and joins every future target", () => {
    expect(
      dietTargetSeries(
        targets,
        "weightKg",
        { date: "2026-10-22", value: 82 },
        "2027-01-01",
      ),
    ).toEqual([
      { date: "2026-10-22", value: 82 },
      { date: "2026-11-01", value: 80 },
      { date: "2026-12-01", value: 78 },
    ]);
  });

  it("skips targets before the start, after the end, or with no value", () => {
    expect(
      dietTargetSeries(
        targets,
        "bodyFatPercent",
        { date: "2026-10-22", value: 19 },
        "2026-12-15",
      ),
    ).toEqual([
      { date: "2026-10-22", value: 19 },
      { date: "2026-11-01", value: 18 },
    ]);
  });

  it("returns nothing when there is no start or no future target", () => {
    expect(dietTargetSeries(targets, "weightKg", null, "2027-01-01")).toEqual(
      [],
    );
    expect(
      dietTargetSeries(
        targets,
        "weightKg",
        { date: "2026-10-22", value: 82 },
        "2026-10-25",
      ),
    ).toEqual([]);
  });
});

describe("dietTargetValueAt", () => {
  const line = [
    { date: "2026-10-22", value: 82 },
    { date: "2026-11-01", value: 80 },
  ];

  it("interpolates between target points", () => {
    expect(dietTargetValueAt(line, "2026-10-27")).toBe(81);
  });

  it("returns null outside the line and the exact value on a point", () => {
    expect(dietTargetValueAt(line, "2026-10-21")).toBeNull();
    expect(dietTargetValueAt(line, "2026-11-02")).toBeNull();
    expect(dietTargetValueAt(line, "2026-11-01")).toBe(80);
  });
});

describe("datesAfter", () => {
  it("returns each day after the start through the end", () => {
    expect(datesAfter("2026-10-30", "2026-11-02")).toEqual([
      { date: "2026-10-31" },
      { date: "2026-11-01" },
      { date: "2026-11-02" },
    ]);
    expect(datesAfter("2026-10-30", "2026-10-30")).toEqual([]);
  });
});
