import { describe, expect, it } from "bun:test";
import { isAfterPlanTomorrowCutoff, localDateTimeInZone } from "./dates.js";

describe("isAfterPlanTomorrowCutoff", () => {
  it("uses the athlete's local hour", () => {
    expect(
      isAfterPlanTomorrowCutoff(
        "Europe/Oslo",
        new Date("2026-11-01T16:59:00Z"),
      ),
    ).toBe(false);
    expect(
      isAfterPlanTomorrowCutoff(
        "Europe/Oslo",
        new Date("2026-11-01T17:00:00Z"),
      ),
    ).toBe(true);
  });

  it("falls back to UTC when the time zone is missing or invalid", () => {
    expect(
      isAfterPlanTomorrowCutoff(null, new Date("2026-11-01T17:59:00Z")),
    ).toBe(false);
    expect(
      isAfterPlanTomorrowCutoff("Not/AZone", new Date("2026-11-01T18:00:00Z")),
    ).toBe(true);
  });
});

describe("localDateTimeInZone", () => {
  it("returns the athlete's local date and clock time", () => {
    expect(
      localDateTimeInZone(new Date("2026-07-01T10:00:00Z"), "Europe/Oslo"),
    ).toEqual({ date: "2026-07-01", time: "12:00" });
    expect(
      localDateTimeInZone(new Date("2026-11-07T22:30:00Z"), "Europe/Oslo"),
    ).toEqual({ date: "2026-11-07", time: "23:30" });
  });

  it("falls back to UTC for a missing or unknown zone", () => {
    const instant = new Date("2026-11-07T22:30:00Z");
    expect(localDateTimeInZone(instant, null)).toEqual({
      date: "2026-11-07",
      time: "22:30",
    });
    expect(localDateTimeInZone(instant, "Not/AZone")).toEqual({
      date: "2026-11-07",
      time: "22:30",
    });
  });
});
