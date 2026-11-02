import { describe, expect, it } from "bun:test";
import type { DailyHealthPoint } from "@killingit/shared";
import {
  formatDailyHealthContext,
  HEALTH_CONTEXT_DAYS,
} from "./healthContext.js";

function series(
  metric: DailyHealthPoint["metric"],
  values: readonly number[],
  startDate = "2026-10-20",
): DailyHealthPoint[] {
  return values.map((value, index) => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return {
      metric,
      date: date.toISOString().slice(0, 10),
      value,
    };
  });
}

describe("formatDailyHealthContext", () => {
  it("shows the latest value, the 7-day average and the trend", () => {
    const points = [
      ...series("sleep_duration", [400, 410, 420, 430, 440, 450, 460]),
    ];

    const text = formatDailyHealthContext(points, "2026-10-26").join("\n");

    expect(text).toContain(
      "Sleep duration: latest 7 h 40 min on 2026-10-26; 7-day average 7 h 10 min",
    );
  });

  it("compares the last week with the week before and ignores later data", () => {
    const points: DailyHealthPoint[] = [
      ...series(
        "resting_heart_rate",
        [60, 60, 60, 60, 60, 60, 60],
        "2026-10-13",
      ),
      ...series(
        "resting_heart_rate",
        [55, 55, 55, 55, 55, 55, 55],
        "2026-10-20",
      ),
      { metric: "resting_heart_rate", date: "2026-10-27", value: 40 },
    ];

    const text = formatDailyHealthContext(points, "2026-10-26").join("\n");

    expect(text).toContain("latest 55 bpm on 2026-10-26");
    expect(text).toContain("7-day average 55 bpm");
    expect(text).toContain("down 5 bpm from the previous week");
    expect(text).not.toContain("40 bpm");
  });

  it("says when no values were synced", () => {
    expect(formatDailyHealthContext([], "2026-10-26")).toEqual([
      `Daily health and recovery (from Garmin, ${HEALTH_CONTEXT_DAYS} days through 2026-10-26):`,
      "- No daily health data was synced for this period.",
    ]);
  });
});
