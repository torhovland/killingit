import { describe, expect, it } from "bun:test";
import { activityLocalDate, zonedDateTime } from "./wallClock.js";

describe("zonedDateTime", () => {
  it("reads an instant as the wall clock of an IANA zone", () => {
    expect(
      zonedDateTime(new Date("2026-07-01T10:00:00Z"), "Europe/Oslo"),
    ).toEqual({
      date: "2026-07-01",
      hour: 12,
      minute: 0,
      second: 0,
    });
    expect(
      zonedDateTime(new Date("2026-11-07T22:30:45Z"), "Europe/Oslo"),
    ).toEqual({
      date: "2026-11-07",
      hour: 23,
      minute: 30,
      second: 45,
    });
  });

  it("follows a DST change on both sides of the boundary", () => {
    // Europe/Oslo moves from CET (+1) to CEST (+2) at 01:00 UTC on 29 March.
    expect(
      zonedDateTime(new Date("2026-03-29T00:59:00Z"), "Europe/Oslo"),
    ).toEqual({ date: "2026-03-29", hour: 1, minute: 59, second: 0 });
    expect(
      zonedDateTime(new Date("2026-03-29T01:00:00Z"), "Europe/Oslo"),
    ).toEqual({ date: "2026-03-29", hour: 3, minute: 0, second: 0 });

    // It moves back from CEST (+2) to CET (+1) at 01:00 UTC on 25 October.
    expect(
      zonedDateTime(new Date("2026-10-25T00:59:00Z"), "Europe/Oslo"),
    ).toEqual({ date: "2026-10-25", hour: 2, minute: 59, second: 0 });
    expect(
      zonedDateTime(new Date("2026-10-25T01:00:00Z"), "Europe/Oslo"),
    ).toEqual({ date: "2026-10-25", hour: 2, minute: 0, second: 0 });
  });

  it("falls back to UTC when the zone is missing, empty or unknown", () => {
    const instant = new Date("2026-11-07T22:30:45Z");
    const utc = {
      date: "2026-11-07",
      hour: 22,
      minute: 30,
      second: 45,
    };
    expect(zonedDateTime(instant, null)).toEqual(utc);
    expect(zonedDateTime(instant, undefined)).toEqual(utc);
    expect(zonedDateTime(instant, "")).toEqual(utc);
    expect(zonedDateTime(instant, "Not/AZone")).toEqual(utc);
  });
});

describe("activityLocalDate", () => {
  it("dates a late evening activity by the athlete's local day", () => {
    // 07:30 UTC is 23:30 on the previous day in Los Angeles (PST, UTC-8).
    const activity = { startDate: "2026-11-12T07:30:00Z" };

    expect(activityLocalDate(activity, "America/Los_Angeles")).toBe(
      "2026-11-11",
    );
    expect(activityLocalDate(activity, "UTC")).toBe("2026-11-12");
  });

  it("dates an early morning activity by the athlete's local day", () => {
    // 15:30 UTC on 11 November is 00:30 on 12 November in Tokyo (JST, UTC+9).
    const activity = { startDate: "2026-11-11T15:30:00Z" };

    expect(activityLocalDate(activity, "Asia/Tokyo")).toBe("2026-11-12");
    expect(activityLocalDate(activity, "UTC")).toBe("2026-11-11");
  });

  it("reads a missing, empty or unknown zone as UTC", () => {
    const activity = { startDate: "2026-11-12T07:30:00Z" };

    expect(activityLocalDate(activity, null)).toBe("2026-11-12");
    expect(activityLocalDate(activity, undefined)).toBe("2026-11-12");
    expect(activityLocalDate(activity, "")).toBe("2026-11-12");
    expect(activityLocalDate(activity, "Not/AZone")).toBe("2026-11-12");
  });
});
