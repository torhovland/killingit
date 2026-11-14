import { describe, expect, it } from "bun:test";
import { BoundedMap, RecentTimestampMap } from "./boundedMap.js";

describe("BoundedMap", () => {
  it("evicts the least recently used entry beyond its limit", () => {
    const map = new BoundedMap<number, string>(2);

    map.set(1, "one");
    map.set(2, "two");
    map.set(3, "three");

    expect(map.get(1)).toBeUndefined();
    expect(map.get(2)).toBe("two");
    expect(map.get(3)).toBe("three");
  });

  it("keeps an entry that is read again ahead of an untouched one", () => {
    const map = new BoundedMap<number, string>(2);

    map.set(1, "one");
    map.set(2, "two");
    expect(map.get(1)).toBe("one");
    map.set(3, "three");

    expect(map.get(1)).toBe("one");
    expect(map.get(2)).toBeUndefined();
  });

  it("replaces a key without counting it twice", () => {
    const map = new BoundedMap<number, string>(2);

    map.set(1, "one");
    map.set(2, "two");
    map.set(1, "updated");

    expect(map.get(1)).toBe("updated");
    expect(map.get(2)).toBe("two");
  });

  it("does not refresh recency when only checking for a key", () => {
    const map = new BoundedMap<number, string>(2);

    map.set(1, "one");
    map.set(2, "two");
    expect(map.has(1)).toBe(true);
    map.set(3, "three");

    expect(map.get(2)).toBe("two");
    expect(map.get(1)).toBeUndefined();
  });

  it("rejects a limit that cannot bound anything", () => {
    expect(() => new BoundedMap<number, string>(0)).toThrow(RangeError);
    expect(() => new BoundedMap<number, string>(1.5)).toThrow(RangeError);
  });
});

describe("RecentTimestampMap", () => {
  it("returns the previous timestamp inside the window", () => {
    const map = new RecentTimestampMap();

    expect(map.record(1, 1_000, 1_500)).toBeNull();
    expect(map.record(1, 1_500, 1_500)).toBe(1_000);
  });

  it("drops keys whose timestamp has left the window", () => {
    const map = new RecentTimestampMap();

    expect(map.record(1, 1_000, 1_500)).toBeNull();
    expect(map.record(2, 2_000, 1_500)).toBeNull();
    // The key recorded at 1_000 is outside the window ending at 2_500, so it
    // is no longer remembered and recording it again looks like a first touch.
    expect(map.record(1, 2_500, 1_500)).toBeNull();
  });

  it("keeps a key recorded inside the window while pruning others", () => {
    const map = new RecentTimestampMap();

    expect(map.record(1, 1_000, 1_500)).toBeNull();
    expect(map.record(2, 2_000, 1_500)).toBeNull();
    expect(map.record(2, 2_500, 1_500)).toBe(2_000);
  });
});
