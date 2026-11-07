import { describe, expect, it } from "bun:test";
import {
  browserTimeZone,
  formatDateTime,
  resolveTimeZone,
  toWallClockValue,
  wallClockToIso,
} from "./timeZone";

describe("resolveTimeZone", () => {
  it("uses a valid stored zone and falls back for an unknown one", () => {
    expect(resolveTimeZone("Europe/Oslo")).toBe("Europe/Oslo");
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(browserTimeZone());
    expect(resolveTimeZone(null)).toBe(browserTimeZone());
  });
});

describe("formatDateTime", () => {
  it("renders an ISO timestamp in the selected zone", () => {
    const formatted = formatDateTime("2026-10-01T06:30:00Z", "Europe/Oslo");

    expect(formatted).toContain("2026");
    expect(formatted).toContain("08:30");
    expect(formatted).not.toMatch(/GMT|CEST|CET|UTC/);
  });
});

describe("wall-clock conversion", () => {
  it("formats an instant as the wall clock of a zone", () => {
    expect(
      toWallClockValue(new Date("2026-07-01T10:00:00Z"), "Europe/Oslo"),
    ).toBe("2026-07-01T12:00");
    expect(
      toWallClockValue(new Date("2026-01-15T11:00:00Z"), "Europe/Oslo"),
    ).toBe("2026-01-15T12:00");
  });

  it("turns a wall clock in a zone into the matching instant", () => {
    expect(wallClockToIso("2026-07-01T12:00", "Europe/Oslo")).toBe(
      "2026-07-01T10:00:00.000Z",
    );
    expect(wallClockToIso("2026-01-15T12:00", "Europe/Oslo")).toBe(
      "2026-01-15T11:00:00.000Z",
    );
  });

  it("round-trips a value across a DST boundary", () => {
    const iso = wallClockToIso("2026-03-29T03:30", "Europe/Oslo");
    expect(toWallClockValue(new Date(iso), "Europe/Oslo")).toBe(
      "2026-03-29T03:30",
    );
  });
});
