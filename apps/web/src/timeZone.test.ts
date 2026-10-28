import { describe, expect, it } from "bun:test";
import { browserTimeZone, resolveTimeZone } from "./timeZone";

describe("resolveTimeZone", () => {
  it("uses a valid stored zone and falls back for an unknown one", () => {
    expect(resolveTimeZone("Europe/Oslo")).toBe("Europe/Oslo");
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(browserTimeZone());
    expect(resolveTimeZone(null)).toBe(browserTimeZone());
  });
});
