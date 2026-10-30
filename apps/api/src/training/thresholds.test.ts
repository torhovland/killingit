import { describe, expect, it } from "bun:test";
import type { AthleteThreshold } from "@killingit/shared";
import {
  buildThresholdSeries,
  buildThresholdTimelines,
  currentThresholdSummaries,
  thresholdAt,
  thresholdForSport,
} from "./thresholds.js";

function point(overrides: Partial<AthleteThreshold> = {}): AthleteThreshold {
  return {
    date: "2026-10-01",
    value: 250,
    source: "user",
    sport: "cycling",
    measure: "ftp",
    label: "FTP",
    unit: "W",
    kind: "power",
    ...overrides,
  };
}

const points: AthleteThreshold[] = [
  point(),
  point({ date: "2026-10-11", value: 260 }),
  point({
    sport: "running",
    measure: "threshold_pace",
    label: "Threshold pace",
    unit: "s/km",
    kind: "pace",
    value: 270,
  }),
  point({
    sport: "running",
    measure: "threshold_heart_rate",
    label: "Threshold heart rate",
    unit: "bpm",
    kind: "heart_rate",
    value: 165,
  }),
];

describe("threshold timelines", () => {
  it("builds one timeline per sport and measure", () => {
    const timelines = buildThresholdTimelines(points);

    expect(timelines.map((entry) => `${entry.sport}:${entry.measure}`)).toEqual(
      ["cycling:ftp", "running:threshold_pace", "running:threshold_heart_rate"],
    );
  });

  it("interpolates between values and holds the last one", () => {
    const [cycling] = buildThresholdTimelines(points);

    expect(thresholdAt(cycling ?? null, "2026-10-06")).toBe(255);
    expect(thresholdAt(cycling ?? null, "2026-10-20")).toBe(260);
  });

  it("selects the threshold for the activity's sport and kind", () => {
    const timelines = buildThresholdTimelines(points);

    expect(
      thresholdForSport(timelines, "running", "pace", "2026-10-05"),
    ).toMatchObject({ value: 270 });
    expect(
      thresholdForSport(timelines, "cycling", "heart_rate", "2026-10-05"),
    ).toBeNull();
  });

  it("ignores future estimates when building the current summaries", () => {
    const summaries = currentThresholdSummaries(
      [...points, point({ date: "2026-11-01", value: 300, source: "coach" })],
      "2026-10-20",
    );

    expect(
      summaries.find(
        (entry) => entry.sport === "cycling" && entry.measure === "ftp",
      )?.value,
    ).toBe(260);
  });

  it("keeps every measure as its own chart series", () => {
    const series = buildThresholdSeries(points);

    expect(series).toHaveLength(3);
    expect(series.map((entry) => entry.measure)).toContain("threshold_pace");
  });
});
