import { describe, expect, it } from "bun:test";
import {
  addDays,
  isAfterPlanTomorrowCutoff,
  localDateTimeInZone,
  startOfWeek,
} from "./dates.js";

describe("startOfWeek", () => {
  it("returns the Monday of the week containing the date", () => {
    expect(startOfWeek("2026-10-21")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
  });
});

describe("addDays", () => {
  it("moves across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-10-21", 7)).toBe("2026-10-28");
  });
});

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
