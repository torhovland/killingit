import { describe, expect, it } from "bun:test";
import type { AthleteEvent } from "@killingit/shared";
import type { PlanContextInput } from "./planContext.js";
import {
  withBlockGoalCoverage,
  withPlanGoalCoverage,
  withSeasonGoalCoverage,
} from "./planGoalSchemas.js";
import {
  initialBlockUpdateSchema,
  planUpdateResponseSchema,
  seasonPlanUpdateSchema,
} from "./planResult.js";
import { makeBlock, makeSeason } from "../testFixtures/plan.js";

const TODAY = "2026-10-21";
const EVENT: AthleteEvent = {
  startDate: "2027-04-01",
  endDate: null,
  title: "Spring marathon",
  kind: "race",
};

function context(overrides: Partial<PlanContextInput> = {}): PlanContextInput {
  return {
    today: TODAY,
    athleteAnswers: [],
    recentActivities: [],
    events: [EVENT],
    ...overrides,
  };
}

function season() {
  return makeSeason({
    goals: [
      {
        title: "Spring marathon",
        date: "2027-04-01",
        priority: "A",
        target: "Under 4:00",
      },
    ],
    blocks: [
      {
        name: "Base",
        focus: "Aerobic",
        startDate: "2026-10-21",
        endDate: "2026-12-01",
        weekCount: 6,
        subGoals: [
          {
            goalTitle: "Spring marathon",
            goalDate: "2027-04-01",
            role: "build",
            target: "Six consistent weeks",
            byDate: "2026-11-30",
          },
        ],
      },
    ],
  });
}

function block() {
  return makeBlock({
    subGoals: [
      {
        goalTitle: "Spring marathon",
        goalDate: "2027-04-01",
        role: "build",
        target: "Six consistent weeks",
        byDate: "2026-11-30",
      },
    ],
  });
}

describe("goal coverage refinements", () => {
  it("accepts a season and block that carry the ledger", () => {
    expect(
      withSeasonGoalCoverage(seasonPlanUpdateSchema, context()).safeParse({
        season: season(),
      }).success,
    ).toBe(true);
    expect(
      withBlockGoalCoverage(initialBlockUpdateSchema, {
        ...context(),
        season: season(),
      }).safeParse({ block: block() }).success,
    ).toBe(true);
  });

  it("rejects a season whose block has no sub-goals", () => {
    const missing = season();
    delete missing.blocks[0]?.subGoals;
    const result = withSeasonGoalCoverage(
      seasonPlanUpdateSchema,
      context(),
    ).safeParse({ season: missing });
    expect(result.success).toBe(false);
  });

  it("rejects a season that omits an upcoming athlete event", () => {
    const missing = season();
    delete missing.goals;
    const result = withSeasonGoalCoverage(
      seasonPlanUpdateSchema,
      context(),
    ).safeParse({ season: missing });
    expect(result.success).toBe(false);
  });

  it("rejects a block without sub-goals and a block that disagrees with its summary", () => {
    const missing = block();
    delete missing.subGoals;
    expect(
      withBlockGoalCoverage(initialBlockUpdateSchema, {
        ...context(),
        season: season(),
      }).safeParse({ block: missing }).success,
    ).toBe(false);

    const mismatched = block();
    if (mismatched.subGoals?.[0]) {
      mismatched.subGoals[0].role = "maintain";
    }
    expect(
      withBlockGoalCoverage(initialBlockUpdateSchema, {
        ...context(),
        season: season(),
      }).safeParse({ block: mismatched }).success,
    ).toBe(false);
  });

  it("checks only the levels a plan update returns", () => {
    const currentSeason = season();
    const currentBlock = block();
    const schema = withPlanGoalCoverage(
      planUpdateResponseSchema({
        season: false,
        block: false,
        week: true,
        today: false,
        tomorrow: false,
        nextWeek: false,
        nextBlock: false,
      }),
      {
        ...context(),
        season: currentSeason,
        block: currentBlock,
      },
    );
    expect(
      schema.safeParse({
        week: {
          startDate: "2026-10-19",
          focus: "Aerobic",
          rationale: "Keep it easy.",
          sessions: Array.from({ length: 7 }, (_, index) => ({
            date: `2026-10-${String(19 + index)}`,
            day: "Monday",
            type: "workout",
            title: "Easy run",
            description: "Easy aerobic work.",
            durationMinutes: 45,
            intensity: "easy",
          })),
        },
      }).success,
    ).toBe(true);
  });
});
