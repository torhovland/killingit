import { describe, expect, it } from "bun:test";
import type { StoredUser } from "../users/store.js";
import { loadDietContext } from "./context.js";
import type { DietSourceEntry } from "./summary.js";

function user(dietAdvice: boolean): StoredUser {
  return {
    id: 42,
    sub: "athlete-1",
    role: "member",
    timezone: null,
    location: null,
    dietAdvice,
    createdAt: new Date(0),
  };
}

const entries: DietSourceEntry[] = [
  {
    eatenDate: "2026-11-07",
    eatenTime: "08:00",
    description: "Porridge",
    analysis: null,
    analysisError: null,
  },
];

describe("loadDietContext", () => {
  it("returns nothing when the athlete has not opted in", async () => {
    let readEntries = false;
    const context = await loadDietContext(42, "2026-11-07", {
      loadUser: () => Promise.resolve(user(false)),
      loadEntries: () => {
        readEntries = true;
        return Promise.resolve(entries);
      },
    });

    expect(context).toBeNull();
    expect(readEntries).toBe(false);
  });

  it("returns the meal window when the athlete opted in", async () => {
    const context = await loadDietContext(42, "2026-11-07", {
      loadUser: () => Promise.resolve(user(true)),
      loadEntries: (userId, sinceDate) => {
        expect(userId).toBe(42);
        expect(sinceDate).toBe("2025-11-07");
        return Promise.resolve(entries);
      },
    });

    expect(context?.meals).toHaveLength(1);
    expect(context?.weeks).toEqual([]);
  });

  it("stays null when the food log cannot be read", async () => {
    const context = await loadDietContext(42, "2026-11-07", {
      loadUser: () => Promise.resolve(user(true)),
      loadEntries: () => Promise.reject(new Error("database down")),
    });

    expect(context).toBeNull();
  });
});
