import { describe, expect, it } from "bun:test";
import type { CoachPlan, WeekPlan } from "@killingit/shared";
import { addDays } from "./dates.js";
import { outlineFutureSessions } from "./outline.js";

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
    },
    tomorrow: null,
    nextWeek: makeWeek("2026-10-26"),
    nextBlock: null,
  };
}

function bikeWorkoutDates(week: WeekPlan): string[] {
  return week.sessions
    .filter((session) => session.bikeWorkout != null)
    .map((session) => session.date);
}

describe("outlineFutureSessions", () => {
  it("keeps detail for today and tomorrow and clears later days", () => {
    const plan = outlineFutureSessions(makePlan(), "2026-10-21");

    expect(bikeWorkoutDates(plan.week)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
    ]);
    expect(
      plan.week.sessions.find((s) => s.date === "2026-10-23")?.bikeWorkout,
    ).toBeNull();
    expect(
      plan.week.sessions.find((s) => s.date === "2026-10-25")?.bikeWorkout,
    ).toBeNull();
  });

  it("keeps tomorrow and clears the rest of a next week", () => {
    const plan = outlineFutureSessions(makePlan(), "2026-10-25");

    expect(plan.nextWeek).not.toBeNull();
    expect(bikeWorkoutDates(plan.nextWeek as WeekPlan)).toEqual(["2026-10-26"]);
  });

  it("leaves estimated TSS on outline days", () => {
    const plan = outlineFutureSessions(makePlan(), "2026-10-21");

    expect(
      plan.week.sessions.find((session) => session.date === "2026-10-25")
        ?.estimatedTss,
    ).toBe(40);
  });

  it("leaves a plan without a next week alone", () => {
    const plan = outlineFutureSessions(
      { ...makePlan(), nextWeek: null },
      "2026-10-21",
    );

    expect(plan.nextWeek).toBeNull();
  });
});
