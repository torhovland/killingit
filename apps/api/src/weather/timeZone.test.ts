import { describe, expect, it } from "bun:test";
import { isValidTimeZone } from "./timeZone.js";

describe("isValidTimeZone", () => {
  it("recognises a runtime time zone and rejects an unknown one", () => {
    expect(isValidTimeZone("Europe/Oslo")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("rejects a blank value, which the stored setting cannot hold", () => {
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
  });
});
