import { describe, expect, it } from "bun:test";
import { formatDuration } from "./duration.js";

describe("formatDuration", () => {
  it("formats minutes/seconds and hours", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("pads seconds below a minute and whole hours", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(3600)).toBe("1:00:00");
  });

  it("rounds to the nearest second", () => {
    expect(formatDuration(64.4)).toBe("1:04");
    expect(formatDuration(64.5)).toBe("1:05");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-30)).toBe("0:00");
  });
});
