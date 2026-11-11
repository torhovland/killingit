import { afterEach, describe, expect, it } from "bun:test";
import {
  claimOutdatedReload,
  OUTDATED_RELOAD_MARKER,
  reportApiOutdated,
  subscribeApiOutdated,
} from "./apiVersion";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("api version mismatch notices", () => {
  const unsubscribes: Array<() => void> = [];

  afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) {
      unsubscribe();
    }
  });

  it("notifies every subscriber and stops after unsubscribing", () => {
    const calls: string[] = [];
    const unsubscribe = subscribeApiOutdated(() => calls.push("first"));
    unsubscribes.push(subscribeApiOutdated(() => calls.push("second")));

    reportApiOutdated();
    unsubscribe();
    reportApiOutdated();

    expect(calls).toEqual(["first", "second", "second"]);
  });

  it("allows one automatic reload per cooldown window", () => {
    const storage = fakeStorage();
    const now = 1_000_000;

    expect(claimOutdatedReload(storage, now)).toBe(true);
    expect(claimOutdatedReload(storage, now + 1000)).toBe(false);
    expect(claimOutdatedReload(storage, now + 60_001)).toBe(true);
    expect(storage.getItem(OUTDATED_RELOAD_MARKER)).toBe(String(now + 60_001));
  });

  it("shows the notice instead of reloading when storage is unavailable", () => {
    const throwing = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };

    expect(claimOutdatedReload(throwing)).toBe(false);
  });
});
