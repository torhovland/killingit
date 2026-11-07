import { describe, expect, it } from "bun:test";
import type { CoachPlan, DayPlan, WeekPlan } from "@killingit/shared";
import { calorieEstimateProblems } from "./calorieEstimates.js";

function day(date: string, calories?: number): DayPlan {
  return {
    date,
    type: "workout",
    title: "Ride",
    description: "An easy ride.",
    durationMinutes: 60,
    intensity: "easy",
    alternatives: [],
    rationale: "Build endurance.",
    optional: false,
    status: "planned",
    ...(calories === undefined ? {} : { estimatedCaloriesKcal: calories }),
  };
}

function week(startDate: string, calories: readonly number[]): WeekPlan {
  const firstDay = Number(startDate.slice(8, 10));
  return {
    startDate,
    focus: "Base",
    sessions: calories.map((value, index) => ({
      ...day(`2026-11-${String(firstDay + index).padStart(2, "0")}`, value),
      day: "Monday",
    })),
    rationale: "Build endurance.",
  };
}

function plan(overrides: Partial<CoachPlan> = {}): CoachPlan {
  return {
    season: {
      goal: "Base",
      startDate: "2026-11-02",
      endDate: "2027-01-01",
      blocks: [
        {
          name: "Base",
          focus: "Base",
          startDate: "2026-11-02",
          endDate: "2027-01-01",
          weekCount: 8,
        },
      ],
      rationale: "Build endurance.",
    },
    block: {
      name: "Base",
      focus: "Base",
      startDate: "2026-11-02",
      endDate: "2027-01-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-11-02",
          focus: "Base",
          targetLoad: "Build",
        },
      ],
      rationale: "Build endurance.",
    },
    week: week("2026-11-02", [2400, 2500, 2600, 2700, 2800, 2900, 3000]),
    today: day("2026-11-02", 2450),
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    ...overrides,
  };
}

describe("calorieEstimateProblems", () => {
  it("accepts a plausible whole-day target", () => {
    expect(calorieEstimateProblems(plan())).toEqual([]);
  });

  it("rejects a deficit or burned-calorie value with its date and path", () => {
    const problems = calorieEstimateProblems(
      plan({ today: day("2026-11-02", 480) }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toEqual(["today", "estimatedCaloriesKcal"]);
    expect(problems[0]?.message).toContain("480 kcal");
    expect(problems[0]?.message).toContain("total daily calorie target");
  });

  it("checks every week session and the next week", () => {
    const problems = calorieEstimateProblems(
      plan({
        week: week("2026-11-02", [2400, 480, 2600, 2700, 2800, 2900, 3000]),
        nextWeek: week("2026-11-09", [2410, 2510, 2610, 2710, 2810, 2910, 500]),
      }),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]?.path).toEqual([
      "week",
      "sessions",
      1,
      "estimatedCaloriesKcal",
    ]);
    expect(problems[1]?.path).toEqual([
      "nextWeek",
      "sessions",
      6,
      "estimatedCaloriesKcal",
    ]);
  });
});
