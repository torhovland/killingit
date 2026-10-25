import { describe, expect, it } from "bun:test";
import { progressAt, recordDuration } from "./progress.js";

describe("progressAt", () => {
  it("starts at the value reached when the step began", () => {
    expect(progressAt(45, 58, 0, 10_000)).toBe(45);
  });

  it("moves halfway at half the expected duration", () => {
    expect(progressAt(40, 60, 5_000, 10_000)).toBe(50);
  });

  it("stops at the target after the expected duration", () => {
    expect(progressAt(40, 60, 30_000, 10_000)).toBe(60);
  });

  it("does not move backwards when the target is below the current value", () => {
    expect(progressAt(80, 72, 5_000, 10_000)).toBe(80);
  });

  it("treats a zero expected duration as an instant step", () => {
    expect(progressAt(40, 60, 0, 0)).toBe(60);
  });

  it("clamps a negative elapsed time to the start", () => {
    expect(progressAt(40, 60, -5_000, 10_000)).toBe(40);
  });
});

describe("recordDuration", () => {
  it("uses the first observation as the average", () => {
    expect(recordDuration(null, 12_000)).toEqual({
      averageMs: 12_000,
      samples: 1,
    });
  });

  it("blends later observations into the average", () => {
    expect(recordDuration({ averageMs: 10_000, samples: 4 }, 20_000)).toEqual({
      averageMs: 13_000,
      samples: 5,
    });
  });

  it("clamps implausibly short observations", () => {
    expect(recordDuration(null, 10)).toEqual({ averageMs: 100, samples: 1 });
  });

  it("clamps implausibly long observations", () => {
    expect(recordDuration(null, 60 * 60 * 1000)).toEqual({
      averageMs: 10 * 60 * 1000,
      samples: 1,
    });
  });
});
