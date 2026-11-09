import { describe, expect, it, spyOn } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import { loadValidatedPlan, type PlanStore, type StoredPlan } from "./store.js";

// A separate user id and generation time keep the loader's once-per-plan
// failure report from colliding with the route tests.
const USER_ID = 9_001;
const GENERATED_AT = new Date("2026-11-09T08:00:00Z");

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Run a marathon.",
      introduction:
        "Hello, I am your coach and I look forward to working with you.",
      startDate: "2026-11-09",
      endDate: "2027-04-01",
      rationale: "Build a base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-11-09",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      rationale: "Establish consistent volume.",
      startDate: "2026-11-09",
      endDate: "2026-12-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-11-09",
          focus: "Aerobic",
          targetLoad: "Easy",
        },
      ],
    },
    week: {
      startDate: "2026-11-09",
      focus: "Aerobic",
      rationale: "Keep the week easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-11-${String(9 + index).padStart(2, "0")}`,
        day: "Monday",
        type: "workout",
        title: `Session ${index + 1}`,
        description: "Easy.",
        durationMinutes: 45,
        intensity: "easy",
        status: "planned",
      })),
    },
    today: {
      date: "2026-11-09",
      type: "workout",
      title: "Easy run",
      description: "This plan body must not reach the logs.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      optionalRationale:
        "This easy run keeps the week consistent; skip it only if you feel unusually tired.",
      status: "planned",
    },
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
  };
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
