import { describe, expect, it } from "bun:test";
import type { CoachPlan, WeekPlan, WeekSession } from "@killingit/shared";
import { weekTotalsForPlan } from "./weekTotals.js";

function session(overrides: Partial<WeekSession>): WeekSession {
  return {
    date: "2026-10-19",
    day: "Monday",
    type: "workout",
    title: "Ride",
    description: "Easy spin.",
    durationMinutes: 60,
    intensity: "easy",
    status: "planned",
    ...overrides,
  };
}

function week(startDate: string, sessions: WeekSession[]): WeekPlan {
  return {
    startDate,
    focus: "Aerobic",
    rationale: "Keep it easy.",
    sessions,
  };
}

function plan(overrides: Partial<CoachPlan>): CoachPlan {
  return {
    week: week("2026-10-19", []),
    nextWeek: null,
    ...overrides,
  } as CoachPlan;
}

describe("weekTotalsForPlan", () => {
  it("totals the workout sessions of the current and next week", () => {
    const totals = weekTotalsForPlan(
      plan({
        week: week("2026-10-19", [
          session({ durationMinutes: 60, estimatedTss: 55 }),
          session({
            date: "2026-10-20",
            durationMinutes: 90,
            estimatedTss: 80,
          }),
          session({
            date: "2026-10-21",
            type: "rest",
            intensity: "rest",
            durationMinutes: 0,
            estimatedTss: 0,
          }),
        ]),
        nextWeek: week("2026-10-26", [
          session({
            date: "2026-10-26",
            durationMinutes: 120,
            trainingLoad: { tss: 100, atl: 50, ctl: 50, tsb: 0 },
          }),
        ]),
      }),
    );

    expect(totals).toEqual([
      { weekStartDate: "2026-10-19", plannedMinutes: 150, plannedTss: 135 },
      { weekStartDate: "2026-10-26", plannedMinutes: 120, plannedTss: 100 },
    ]);
  });

  it("omits a week the plan does not carry", () => {
    expect(
      weekTotalsForPlan(
        plan({
          week: week("2026-10-19", [
            session({ durationMinutes: 45, estimatedTss: 40 }),
          ]),
          nextWeek: null,
        }),
      ),
    ).toEqual([
      { weekStartDate: "2026-10-19", plannedMinutes: 45, plannedTss: 40 },
    ]);
  });
});
