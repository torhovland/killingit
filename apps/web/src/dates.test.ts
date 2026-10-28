import { describe, expect, it } from "bun:test";
import { formatDate, formatDateTime, formatMonth } from "./dates";

describe("formatDate", () => {
  it("writes a calendar date as d. MMM YYYY", () => {
    expect(formatDate("2026-10-01")).toBe("1. Oct 2026");
    expect(formatDate("2026-10-22")).toBe("22. Oct 2026");
  });

  it("accepts a timestamp and uses its calendar date", () => {
    expect(formatDate("2026-10-06T07:00:00.000Z")).toBe("6. Oct 2026");
  });

  it("passes through anything unexpected", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("formatMonth", () => {
  it("writes a month as MMM YYYY", () => {
    expect(formatMonth("2026-10")).toBe("Oct 2026");
  });

  it("passes through anything unexpected", () => {
    expect(formatMonth("2026")).toBe("2026");
  });
});

describe("formatDateTime", () => {
  it("renders an ISO timestamp in the selected zone with a 24-hour clock", () => {
    const formatted = formatDateTime("2026-10-01T06:30:00Z", "Europe/Oslo");

    expect(formatted).toBe("1. Oct 2026, 08:30");
    expect(formatted).not.toMatch(/GMT|CEST|CET|UTC/);
  });

  it("uses 00 for midnight instead of 24", () => {
    expect(formatDateTime("2026-10-01T22:30:00Z", "Europe/Oslo")).toBe(
      "2. Oct 2026, 00:30",
    );
  });

  it("passes through an invalid timestamp", () => {
    expect(formatDateTime("not-a-date", "Europe/Oslo")).toBe("not-a-date");
  });
});
