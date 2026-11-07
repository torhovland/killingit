import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import { planDietTargets } from "./dietTargets.js";

const progress = (
  targetWeightKg: number | null,
  targetBodyFatPercent: number | null,
  note = "Expected progress.",
) => ({ targetWeightKg, targetBodyFatPercent, note });

function plan(overrides: Partial<CoachPlan> = {}): CoachPlan {
  return {
    season: {
      goal: "Ride a century.",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      rationale: "Build endurance.",
      dietProgress: progress(78, 15),
      blocks: [
        {
          name: "Past",
          focus: "Base",
          startDate: "2026-09-01",
          endDate: "2026-10-18",
          weekCount: 7,
          dietProgress: progress(84, 20),
        },
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-19",
          endDate: "2026-11-29",
          weekCount: 6,
          dietProgress: progress(82, 18),
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      startDate: "2026-10-19",
      endDate: "2026-11-29",
      rationale: "Build the base.",
      dietProgress: progress(81, 18),
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
          dietProgress: progress(83, null),
        },
        {
          number: 2,
          startDate: "2026-10-26",
          focus: "Aerobic",
          targetLoad: "Easy",
          dietProgress: progress(82.5, 19),
        },
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic",
      rationale: "Keep it easy.",
      dietProgress: progress(82.8, 19),
      sessions: [],
    },
    today: {
      date: "2026-10-22",
      type: "rest",
      title: "Rest",
      description: "Rest.",
      durationMinutes: 0,
      intensity: "rest",
      alternatives: [],
      rationale: "Recovery.",
      optional: false,
      status: "rest",
    },
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    ...overrides,
  };
}

describe("planDietTargets", () => {
  it("flattens period ends from today onward, ascending", () => {
    const targets = planDietTargets(plan(), "2026-10-22");

    expect(targets.map((target) => target.date)).toEqual([
      "2026-10-25",
      "2026-11-01",
      "2026-11-29",
      "2027-04-01",
    ]);
    // The past season block is left out.
    expect(targets[0]).toEqual({
      date: "2026-10-25",
      weightKg: 82.8,
      bodyFatPercent: 19,
    });
  });

  it("keeps an earlier measure when a newer target leaves it null", () => {
    const targets = planDietTargets(plan(), "2026-10-22");
    const blockEnd = targets.find((target) => target.date === "2026-11-29");

    // The block target has no body fat, but the season block had 18 %.
    expect(blockEnd).toEqual({
      date: "2026-11-29",
      weightKg: 81,
      bodyFatPercent: 18,
    });
  });

  it("lets the weekly target win on a shared date", () => {
    const shared = plan({
      season: {
        ...plan().season,
        dietProgress: progress(80, 16),
        blocks: [],
      },
      block: {
        ...plan().block,
        endDate: "2026-10-25",
        dietProgress: progress(81, 17),
        weeks: [],
      },
    });
    const targets = planDietTargets(shared, "2026-10-22");

    expect(targets).toEqual([
      { date: "2026-10-25", weightKg: 82.8, bodyFatPercent: 19 },
      { date: "2027-04-01", weightKg: 80, bodyFatPercent: 16 },
    ]);
  });

  it("ignores targets without a number and a plan with no target", () => {
    const noteOnly = plan({
      season: {
        ...plan().season,
        dietProgress: progress(null, null),
        blocks: [],
      },
      block: {
        ...plan().block,
        dietProgress: progress(null, null),
        weeks: [],
      },
      week: { ...plan().week, dietProgress: progress(null, null) },
    });
    expect(planDietTargets(noteOnly, "2026-10-22")).toEqual([]);
    expect(planDietTargets(undefined, "2026-10-22")).toEqual([]);
  });
});
