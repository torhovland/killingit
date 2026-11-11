import { describe, expect, it } from "bun:test";
import type { CoachPlan, WeekPlan } from "@killingit/shared";
import {
  makeDay,
  makePlan as makeFixturePlan,
  makeWeek as makeFixtureWeek,
} from "../testFixtures/plan.js";
import { outlineWeekPlans } from "./outline.js";

const bikeWorkout = {
  ftpWatts: 250,
  intervals: [{ durationSeconds: 600, powerPercent: 75 }],
};

function makeWeek(startDate: string): WeekPlan {
  const week = makeFixtureWeek(startDate);
  return {
    ...week,
    sessions: week.sessions.map((session) => ({
      ...session,
      estimatedTss: 40,
      bikeWorkout,
    })),
  };
}

function makePlan(): CoachPlan {
  return makeFixturePlan({
    week: makeWeek("2026-10-19"),
    today: makeDay("2026-10-21", { bikeWorkout }),
    nextWeek: makeWeek("2026-10-26"),
  });
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
