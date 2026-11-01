import { describe, expect, it } from "bun:test";
import type { CoachPlan, WeekPlan } from "@killingit/shared";
import { addDays } from "./dates.js";
import { outlineWeekPlans } from "./outline.js";

const bikeWorkout = {
  ftpWatts: 250,
  intervals: [{ durationSeconds: 600, powerPercent: 75 }],
};

function makeWeek(startDate: string): WeekPlan {
  return {
    startDate,
    focus: "Aerobic base",
    rationale: "Keep the week easy.",
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: addDays(startDate, index),
      day: "Monday",
      type: "workout" as const,
      title: `Session ${index + 1}`,
      description: "Easy aerobic work.",
      durationMinutes: 45,
      intensity: "easy" as const,
      status: "planned" as const,
      estimatedTss: 40,
      bikeWorkout,
    })),
  };
}

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Sub-4-hour marathon",
      startDate: "2026-10-01",
      endDate: "2027-04-01",
      rationale: "Build aerobic base.",
      blocks: [],
    },
    block: {
      name: "Base",
      focus: "Aerobic endurance",
      rationale: "Establish volume.",
      startDate: "2026-10-19",
      endDate: "2026-12-01",
      weeks: [],
    },
    week: makeWeek("2026-10-19"),
    today: {
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "45 minutes easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Aerobic work.",
      optional: false,
      status: "planned",
      bikeWorkout,
    },
    tomorrow: null,
    nextWeek: makeWeek("2026-10-26"),
    nextBlock: null,
  };
}

describe("outlineWeekPlans", () => {
  it("clears every structured workout from the current week", () => {
    const plan = outlineWeekPlans(makePlan());

    expect(
      plan.week.sessions.every((session) => session.bikeWorkout == null),
    ).toBe(true);
  });

  it("clears every structured workout from the next week", () => {
    const plan = outlineWeekPlans(makePlan());

    expect(
      plan.nextWeek?.sessions.every((session) => session.bikeWorkout == null),
    ).toBe(true);
  });

  it("keeps the detailed workout on today's day plan", () => {
    const plan = outlineWeekPlans(makePlan());

    expect(plan.today.bikeWorkout).toEqual(bikeWorkout);
  });

  it("leaves estimated TSS on outline days", () => {
    const plan = outlineWeekPlans(makePlan());

    expect(
      plan.week.sessions.find((session) => session.date === "2026-10-25")
        ?.estimatedTss,
    ).toBe(40);
  });

  it("leaves a plan without a next week alone", () => {
    const plan = outlineWeekPlans({ ...makePlan(), nextWeek: null });

    expect(plan.nextWeek).toBeNull();
  });
});
