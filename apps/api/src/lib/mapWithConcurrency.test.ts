import { describe, expect, it } from "bun:test";
import { mapWithConcurrency } from "./mapWithConcurrency.js";

describe("mapWithConcurrency", () => {
  it("preserves input order", async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
      await Bun.sleep(value);
      return value * 10;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(1);
      active -= 1;
    });

    expect(maxActive).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 3, () => Promise.resolve(1))).toEqual(
      [],
    );
  });
});
