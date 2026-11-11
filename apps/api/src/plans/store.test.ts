import { describe, expect, it, spyOn } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import {
  makeDay,
  makePlan as makeFixturePlan,
  makeWeek,
} from "../testFixtures/plan.js";
import { loadValidatedPlan, type PlanStore, type StoredPlan } from "./store.js";

// A separate user id and generation time keep the loader's once-per-plan
// failure report from colliding with the route tests.
const USER_ID = 9_001;
const GENERATED_AT = new Date("2026-11-09T08:00:00Z");

function makePlan(): CoachPlan {
  return makeFixturePlan({
    today: makeDay("2026-11-09", {
      description: "This plan body must not reach the logs.",
    }),
    week: makeWeek("2026-11-09"),
  });
}

function makeStored(plan: CoachPlan): StoredPlan {
  return {
    plan,
    answersUpdatedAt: null,
    coachingInputsUpdatedAt: null,
    activitiesUpdatedAt: null,
    generatedAt: GENERATED_AT,
  };
}

function storeWith(stored: StoredPlan | null): PlanStore {
  return {
    load: () => Promise.resolve(stored),
    save: () => Promise.reject(new Error("not used")),
  };
}

describe("loadValidatedPlan", () => {
  it("returns null when no plan is stored", async () => {
    expect(await loadValidatedPlan(storeWith(null), USER_ID)).toBeNull();
  });

  it("returns the stored plan when it matches the schema", async () => {
    const stored = makeStored(makePlan());

    expect(await loadValidatedPlan(storeWith(stored), USER_ID)).toEqual(stored);
  });

  it("treats an invalid plan as absent and logs its date without the body", async () => {
    const invalid = makePlan();
    delete (invalid.week as unknown as Record<string, unknown>).rationale;
    const stored = makeStored(invalid);
    const error = spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(
        await loadValidatedPlan(storeWith(stored), USER_ID + 1),
      ).toBeNull();

      expect(error).toHaveBeenCalledTimes(1);
      const call = error.mock.calls[0];
      expect(String(call?.[0])).toContain("stored plan");
      expect(call?.[1]).toMatchObject({ planDate: "2026-11-09" });
      expect(JSON.stringify(call?.[1])).not.toContain(
        invalid.today.description,
      );
    } finally {
      error.mockRestore();
    }
  });

  it("reports a corrupt plan only once while it is read repeatedly", async () => {
    const invalid = makePlan();
    delete (invalid.week as unknown as Record<string, unknown>).rationale;
    const store = storeWith(makeStored(invalid));
    const error = spyOn(console, "error").mockImplementation(() => {});

    try {
      await loadValidatedPlan(store, USER_ID + 2);
      await loadValidatedPlan(store, USER_ID + 2);

      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });
});
