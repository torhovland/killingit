import { describe, expect, it } from "bun:test";
import type {
  CalorieBreakdown,
  CoachPlan,
  DayPlan,
  WeekPlan,
} from "@killingit/shared";
import { dayCaloriesForPlan } from "./dayCalories.js";

function day(
  date: string,
  calories?: number,
  breakdown?: CalorieBreakdown,
): DayPlan {
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
    ...(breakdown === undefined ? {} : { calorieBreakdown: breakdown }),
  };
}

function week(startDate: string, calories: readonly number[]): WeekPlan {
  const firstDay = Number(startDate.slice(8, 10));
  const sessions = calories.map((value, index) => {
    const date = `2026-11-${String(firstDay + index).padStart(2, "0")}`;
    return {
      ...day(date, value),
      day: "Monday",
    };
  });
  return {
    startDate,
    focus: "Base",
    sessions,
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
    nextWeek: week("2026-11-09", [2410, 2510, 2610, 2710, 2810, 2910, 3010]),
    nextBlock: null,
    diet: { goal: "Lose 3 kg", assessment: "On track." },
    ...overrides,
  };
}

describe("dayCaloriesForPlan", () => {
  it("collects the current and next week and lets the day plan win", () => {
    const calories = dayCaloriesForPlan(plan());
    expect(calories.get("2026-11-02")?.caloriesKcal).toBe(2450);
    expect(calories.get("2026-11-03")?.caloriesKcal).toBe(2500);
    expect(calories.get("2026-11-09")?.caloriesKcal).toBe(2410);
  });

  it("stores the breakdown and uses its sum as the allocated target", () => {
    const calories = dayCaloriesForPlan(
      plan({
        today: day("2026-11-02", 9999, {
          basalMetabolismKcal: 1800,
          workoutCaloriesKcal: 400,
          dietDeficitKcal: 300,
        }),
      }),
    );
    expect(calories.get("2026-11-02")).toEqual({
      caloriesKcal: 1900,
      calorieBreakdown: {
        basalMetabolismKcal: 1800,
        workoutCaloriesKcal: 400,
        dietDeficitKcal: 300,
      },
    });
  });

  it("omits days without an estimate", () => {
    const calories = dayCaloriesForPlan(
      plan({
        week: week("2026-11-02", [2400, 0, 2600, 2700, 2800, 2900, 3000]),
      }),
    );
    expect(calories.has("2026-11-03")).toBe(false);
  });

  it("omits a value below the whole-day safety minimum", () => {
    const calories = dayCaloriesForPlan(
      plan({
        week: week("2026-11-02", [2400, 480, 2600, 2700, 2800, 2900, 3000]),
      }),
    );
    expect(calories.has("2026-11-03")).toBe(false);
  });
});
