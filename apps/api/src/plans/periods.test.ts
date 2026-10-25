import { describe, expect, it } from "bun:test";
import type {
  BlockPlan,
  CoachPlan,
  DayPlan,
  WeekPlan,
} from "@killingit/shared";
import { addDays } from "./dates.js";
import {
  blockFor,
  promoteNextPeriod,
  weekCovers,
  weekEnd,
  weekFor,
} from "./periods.js";

function makeWeek(startDate: string): WeekPlan {
  return {
    startDate,
    focus: "Aerobic base",
    rationale: "Keep the week easy.",
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: addDays(startDate, index),
      day: "Monday",
      type: "workout",
      title: `Session ${index + 1}`,
      description: "Easy aerobic work.",
      durationMinutes: 45,
      intensity: "easy",
      status: "planned",
    })),
  };
}

function makeBlock(startDate: string, endDate: string): BlockPlan {
  return {
    name: "Base",
    focus: "Aerobic endurance",
    rationale: "Establish consistent volume.",
    startDate,
    endDate,
    weeks: [
      {
        number: 1,
        startDate,
        focus: "Aerobic base",
        targetLoad: "Easy",
      },
    ],
  };
}

function makeDay(date: string, title = "Easy run"): DayPlan {
  return {
    date,
    type: "workout",
    title,
    description: "45 minutes easy.",
    durationMinutes: 45,
    intensity: "easy",
    alternatives: [],
    rationale: "Easy aerobic work.",
    optional: false,
    status: "planned",
  };
}

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Marathon",
      startDate: "2026-10-01",
      endDate: "2027-04-01",
      rationale: "Build a base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-01",
          endDate: "2026-10-25",
          weekCount: 4,
        },
      ],
    },
    block: makeBlock("2026-10-01", "2026-10-25"),
    week: makeWeek("2026-10-19"),
    today: makeDay("2026-10-25"),
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
  };
}

describe("weekEnd", () => {
  it("returns the Sunday of a Monday-based week", () => {
    expect(weekEnd(makeWeek("2026-10-19"))).toBe("2026-10-25");
  });
});

describe("weekCovers", () => {
  it("includes both ends of the week and excludes other dates", () => {
    const week = makeWeek("2026-10-19");
    expect(weekCovers(week, "2026-10-19")).toBe(true);
    expect(weekCovers(week, "2026-10-25")).toBe(true);
    expect(weekCovers(week, "2026-10-18")).toBe(false);
    expect(weekCovers(week, "2026-10-26")).toBe(false);
  });
});

describe("weekFor and blockFor", () => {
  it("finds the current and next period around a date", () => {
    const plan: CoachPlan = {
      ...makePlan(),
      nextWeek: makeWeek("2026-10-26"),
      nextBlock: makeBlock("2026-10-26", "2026-12-06"),
    };

    expect(weekFor(plan, "2026-10-25")?.startDate).toBe("2026-10-19");
    expect(weekFor(plan, "2026-10-26")?.startDate).toBe("2026-10-26");
    expect(weekFor(plan, "2026-11-02")).toBeNull();
    expect(blockFor(plan, "2026-10-25")?.startDate).toBe("2026-10-01");
    expect(blockFor(plan, "2026-10-26")?.startDate).toBe("2026-10-26");
    expect(blockFor(plan, "2027-01-01")).toBeNull();
  });
});

describe("promoteNextPeriod", () => {
  it("leaves the plan alone while the next period is still in the future", () => {
    const plan: CoachPlan = {
      ...makePlan(),
      nextWeek: makeWeek("2026-10-26"),
      nextBlock: makeBlock("2026-10-26", "2026-12-06"),
    };

    expect(promoteNextPeriod(plan, "2026-10-25")).toBe(plan);
  });

  it("promotes both periods and takes today's session from tomorrow", () => {
    const plan: CoachPlan = {
      ...makePlan(),
      tomorrow: makeDay("2026-10-26", "Monday easy run"),
      nextWeek: makeWeek("2026-10-26"),
      nextBlock: makeBlock("2026-10-26", "2026-12-06"),
    };

    const promoted = promoteNextPeriod(plan, "2026-10-26");

    expect(promoted.week.startDate).toBe("2026-10-26");
    expect(promoted.nextWeek).toBeNull();
    expect(promoted.block.startDate).toBe("2026-10-26");
    expect(promoted.nextBlock).toBeNull();
    expect(promoted.today.date).toBe("2026-10-26");
    expect(promoted.today.title).toBe("Monday easy run");
    expect(promoted.tomorrow).toBeNull();
  });

  it("clears a tomorrow that is no longer the next day", () => {
    const plan: CoachPlan = {
      ...makePlan(),
      today: makeDay("2026-10-25"),
      tomorrow: makeDay("2026-10-26"),
    };

    expect(promoteNextPeriod(plan, "2026-10-27").tomorrow).toBeNull();
  });

  it("drops a next period that has already ended", () => {
    const plan: CoachPlan = {
      ...makePlan(),
      nextWeek: makeWeek("2026-10-26"),
      nextBlock: makeBlock("2026-10-26", "2026-11-01"),
    };

    const promoted = promoteNextPeriod(plan, "2026-11-05");

    expect(promoted.nextWeek).toBeNull();
    expect(promoted.nextBlock).toBeNull();
    expect(promoted.week.startDate).toBe("2026-10-19");
  });
});
