import { describe, expect, it } from "bun:test";
import { fallbackManualTss } from "./manualTss.js";

describe("fallbackManualTss", () => {
  it("scores a hard race from its duration and heart rate", () => {
    expect(
      fallbackManualTss("I did a 3 hour Zwift race with average HR at 187 bpm"),
    ).toBe(255);
  });

  it("reads compact and hyphenated durations", () => {
    expect(fallbackManualTss("1h30 easy hike")).toBe(53);
    expect(fallbackManualTss("3-hour ride")).toBe(165);
  });

  it("scores an easy session lower than a hard one", () => {
    expect(fallbackManualTss("45 minutes easy run")).toBe(34);
  });

  it("returns zero when no duration is given", () => {
    expect(fallbackManualTss("Pool swim")).toBe(0);
  });
});
