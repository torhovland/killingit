import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import {
  makeBlock,
  makeDay,
  makePlan as makeFixturePlan,
  makeSeason,
  makeWeek,
} from "../testFixtures/plan.js";
import {
  blockFor,
  promoteNextPeriod,
  weekCovers,
  weekEnd,
  weekFor,
} from "./periods.js";

function makePlan(): CoachPlan {
  return makeFixturePlan({
    season: makeSeason({
      startDate: "2026-10-01",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-01",
          endDate: "2026-10-25",
          weekCount: 4,
        },
      ],
    }),
    block: makeBlock({ startDate: "2026-10-01", endDate: "2026-10-25" }),
    week: makeWeek("2026-10-19"),
    today: makeDay("2026-10-25"),
  });
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
      nextBlock: makeBlock({ startDate: "2026-10-26", endDate: "2026-12-06" }),
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
      nextBlock: makeBlock({ startDate: "2026-10-26", endDate: "2026-12-06" }),
    };

    expect(promoteNextPeriod(plan, "2026-10-25")).toBe(plan);
  });

  it("promotes both periods and takes today's session from tomorrow", () => {
    const plan: CoachPlan = {
      ...makePlan(),
      tomorrow: makeDay("2026-10-26", { title: "Monday easy run" }),
      nextWeek: makeWeek("2026-10-26"),
      nextBlock: makeBlock({ startDate: "2026-10-26", endDate: "2026-12-06" }),
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
      nextBlock: makeBlock({ startDate: "2026-10-26", endDate: "2026-11-01" }),
    };

    const promoted = promoteNextPeriod(plan, "2026-11-05");

    expect(promoted.nextWeek).toBeNull();
    expect(promoted.nextBlock).toBeNull();
    expect(promoted.week.startDate).toBe("2026-10-19");
  });
});
