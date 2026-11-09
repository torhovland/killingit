import { describe, expect, it } from "bun:test";
import type { AthleteThreshold } from "@killingit/shared";
import {
  buildThresholdSeries,
  buildThresholdTimelines,
  currentThresholdSummaries,
  FTP_THRESHOLD,
  ftpBaselineAt,
  ftpHistoryPoints,
  ftpTimeline,
  ftpWattsAt,
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

describe("threshold interpolation edge cases", () => {
  it("holds the earliest value before the first anchor", () => {
    const [cycling] = buildThresholdTimelines(points);

    expect(thresholdAt(cycling ?? null, "2026-09-01")).toBe(250);
  });

  it("returns null without a timeline or anchors", () => {
    const empty = {
      sport: "cycling",
      measure: "ftp",
      label: "FTP",
      unit: "W",
      kind: "power" as const,
      anchors: [],
    };

    expect(thresholdAt(null, "2026-10-01")).toBeNull();
    expect(thresholdAt(empty, "2026-10-01")).toBeNull();
  });

  it("returns null for an unreadable date", () => {
    const [cycling] = buildThresholdTimelines(points);

    expect(thresholdAt(cycling ?? null, "not-a-date")).toBeNull();
  });

  it("keeps the last anchor for a duplicate timestamp", () => {
    const [cycling] = buildThresholdTimelines([
      point({ date: "2026-10-01", value: 240 }),
      point({ date: "2026-10-01", value: 250 }),
    ]);

    expect(cycling?.anchors).toHaveLength(1);
    expect(thresholdAt(cycling ?? null, "2026-10-01")).toBe(250);
  });
});

describe("FTP from the threshold timelines", () => {
  it("selects the cycling FTP timeline from every measure", () => {
    const timelines = buildThresholdTimelines(points);

    expect(ftpTimeline(timelines)).toMatchObject(FTP_THRESHOLD);
    expect(ftpTimeline([])).toBeNull();
  });

  it("interpolates between points and marks a measurement", () => {
    const timeline = ftpTimeline(
      buildThresholdTimelines([
        point({ date: "2026-10-01", value: 240 }),
        point({ date: "2026-10-10", value: 250, source: "coach" }),
        point({ date: "2026-10-20", value: 260 }),
      ]),
    );

    expect(ftpWattsAt(timeline, "2026-10-05")).toBe(244);
    expect(ftpBaselineAt(timeline, "2026-10-15")).toEqual({
      watts: 250,
      fromRevision: false,
    });
    expect(ftpBaselineAt(timeline, "2026-10-20")).toEqual({
      watts: 260,
      fromRevision: true,
    });
  });

  it("excludes values dated after the reference day", () => {
    const timeline = ftpTimeline(
      buildThresholdTimelines(
        [
          point({ date: "2026-10-01", value: 240 }),
          point({ date: "2026-10-10", value: 250, source: "coach" }),
          point({ date: "2026-10-20", value: 260 }),
        ],
        "2026-10-10",
      ),
    );

    expect(ftpBaselineAt(timeline, "2026-10-20")).toEqual({
      watts: 250,
      fromRevision: false,
    });
  });

  it("keeps a user or Garmin value when a coach estimate shares its date", () => {
    const user = ftpTimeline(
      buildThresholdTimelines([
        point({ date: "2026-10-10", value: 250 }),
        point({ date: "2026-10-10", value: 300, source: "coach" }),
      ]),
    );
    const garmin = ftpTimeline(
      buildThresholdTimelines([
        point({ date: "2026-10-10", value: 265, source: "garmin" }),
        point({ date: "2026-10-10", value: 300, source: "coach" }),
      ]),
    );

    expect(ftpBaselineAt(user, "2026-10-10")).toEqual({
      watts: 250,
      fromRevision: true,
    });
    expect(ftpBaselineAt(garmin, "2026-10-10")).toEqual({
      watts: 265,
      fromRevision: true,
    });
  });

  it("reports a measurement when the athlete retests after a projection", () => {
    const timeline = ftpTimeline(
      buildThresholdTimelines([
        point({ date: "2026-10-01", value: 250, source: "coach" }),
        point({ date: "2026-10-12", value: 268 }),
      ]),
    );

    expect(ftpBaselineAt(timeline, "2026-10-11")).toEqual({
      watts: 250,
      fromRevision: false,
    });
    expect(ftpBaselineAt(timeline, "2026-10-12")).toEqual({
      watts: 268,
      fromRevision: true,
    });
  });

  it("has no FTP when the athlete has stated none", () => {
    const running = buildThresholdTimelines([
      point({
        sport: "running",
        measure: "threshold_pace",
        label: "Threshold pace",
        unit: "s/km",
        kind: "pace",
      }),
    ]);

    expect(ftpTimeline(running)).toBeNull();
    expect(ftpWattsAt(null, "2026-10-20")).toBeNull();
    expect(ftpBaselineAt(null, "2026-10-20")).toBeNull();
  });

  it("returns the FTP history as prompt points through a date", () => {
    const timelines = buildThresholdTimelines([
      point({ date: "2026-10-01", value: 240 }),
      point({ date: "2026-10-20", value: 250, source: "coach" }),
      point({ date: "2026-11-15", value: 270, source: "coach" }),
    ]);

    expect(ftpHistoryPoints(timelines, "2026-10-21")).toEqual([
      { date: "2026-10-01", value: 240, source: "user" },
      { date: "2026-10-20", value: 250, source: "coach" },
    ]);
  });
});
