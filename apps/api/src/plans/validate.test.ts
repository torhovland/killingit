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
});
