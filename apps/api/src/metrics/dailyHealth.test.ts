import { describe, expect, it } from "bun:test";
import { withoutInProgressDailyHealth } from "./dailyHealth.js";

describe("withoutInProgressDailyHealth", () => {
  it("drops today's running values so the last completed day is read", () => {
    const points = [
      { metric: "body_battery_high" as const, date: "2026-11-13", value: 82 },
      { metric: "body_battery_high" as const, date: "2026-11-14", value: 41 },
      { metric: "body_battery_low" as const, date: "2026-11-14", value: 15 },
    ];

    expect(withoutInProgressDailyHealth(points, "2026-11-14")).toEqual([
      { metric: "body_battery_high", date: "2026-11-13", value: 82 },
    ]);
  });

  it("keeps a completed metric recorded for today", () => {
    const points = [
      { metric: "resting_heart_rate" as const, date: "2026-11-14", value: 48 },
      { metric: "sleep_score" as const, date: "2026-11-14", value: 79 },
    ];

    expect(withoutInProgressDailyHealth(points, "2026-11-14")).toEqual(points);
  });

  it("leaves an empty series empty", () => {
    expect(withoutInProgressDailyHealth([], "2026-11-14")).toEqual([]);
  });
});
