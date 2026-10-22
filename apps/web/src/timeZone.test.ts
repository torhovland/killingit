import { describe, expect, it } from "bun:test";
import { browserTimeZone, formatDateTime, resolveTimeZone } from "./timeZone";

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
