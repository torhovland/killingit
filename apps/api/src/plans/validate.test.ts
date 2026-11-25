import { describe, expect, it } from "bun:test";
import { PLAN_TODAY, makePlan } from "../testFixtures/plan.js";
import { assertPlanValid } from "./validate.js";

function planWithLedger() {
  const plan = makePlan();
  return makePlan({
    season: {
      ...plan.season,
      goals: [
        {
          title: "Sub-4-hour marathon",
          date: "2027-04-01",
          priority: "A",
          target: "Under 4:00",
        },
      ],
      blocks: plan.season.blocks.map((block) => ({
        ...block,
        subGoals: [
          {
            goalTitle: "Sub-4-hour marathon",
            goalDate: "2027-04-01",
            role: "build",
            target: "Six consistent weeks",
            byDate: "2026-11-30",
          },
        ],
      })),
    },
    block: {
      ...plan.block,
      subGoals: [
        {
          goalTitle: "Sub-4-hour marathon",
          goalDate: "2027-04-01",
          role: "build",
          target: "Six consistent weeks",
          byDate: "2026-11-30",
        },
      ],
    },
  });
}

describe("goal ledger validation", () => {
  it("accepts a plan whose blocks carry their sub-goals", () => {
    expect(() =>
      assertPlanValid(planWithLedger(), PLAN_TODAY, false),
    ).not.toThrow();
  });

  it("rejects a plan whose block lost its sub-goals", () => {
    const plan = planWithLedger();
    const block = { ...plan.block };
    delete block.subGoals;
    expect(() =>
      assertPlanValid({ ...plan, block }, PLAN_TODAY, false),
    ).toThrow('must carry "subGoals"');
  });

  it("rejects a season boundary that does not fall between calendar weeks", () => {
    const plan = makePlan();
    const season = {
      ...plan.season,
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: plan.season.startDate,
          endDate: "2026-12-07",
          weekCount: 7,
        },
        {
          name: "Build",
          focus: "Threshold",
          startDate: "2026-12-08",
          endDate: plan.season.endDate,
          weekCount: 17,
        },
      ],
    };

    expect(() =>
      assertPlanValid({ ...plan, season }, PLAN_TODAY, false),
    ).toThrow("boundary in the middle of a week");
  });

  it("accepts a season boundary from Sunday to Monday", () => {
    const plan = makePlan();
    const season = {
      ...plan.season,
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: plan.season.startDate,
          endDate: "2026-12-06",
          weekCount: 7,
        },
        {
          name: "Build",
          focus: "Threshold",
          startDate: "2026-12-07",
          endDate: plan.season.endDate,
          weekCount: 17,
        },
      ],
    };

    expect(() =>
      assertPlanValid({ ...plan, season }, PLAN_TODAY, false),
    ).not.toThrow();
  });
});
