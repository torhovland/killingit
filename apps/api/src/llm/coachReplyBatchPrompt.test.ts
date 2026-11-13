import { describe, expect, it } from "bun:test";
import {
  makeDay,
  makePlan,
  makeWeek,
  PLAN_TODAY,
  PLAN_WEEK_START,
} from "../testFixtures/plan.js";
import { buildCoachReplyBatchMessages } from "./coachReplyBatchPrompt.js";
import type { PlanContextInput } from "./planContext.js";
import {
  PLAN_CHANGE_FLAG_RULES,
  REPLY_PLAN_CHANGE_RULES,
} from "./promptRules.js";

const plan = makePlan({
  week: makeWeek(PLAN_WEEK_START),
  today: makeDay(PLAN_TODAY),
});

function makeContext(): PlanContextInput {
  return { today: PLAN_TODAY, athleteAnswers: [], recentActivities: [] };
}

describe("buildCoachReplyBatchMessages", () => {
  it("carries the reply's plan-change decision rule for every item", () => {
    const messages = buildCoachReplyBatchMessages({
      plan,
      context: makeContext(),
      items: [
        {
          id: "1",
          request: {
            kind: "activity_comment",
            activityDate: PLAN_TODAY,
            comment: "Felt strong on the hills.",
          },
        },
      ],
    });

    expect(messages[0]?.content).toContain(REPLY_PLAN_CHANGE_RULES);
    expect(messages[0]?.content).toContain(PLAN_CHANGE_FLAG_RULES);
    expect(messages[0]?.content).not.toContain(
      "explain how it affects the plan",
    );
    expect(messages[1]?.content).toContain("id: 1");
  });
});
