import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatPlanContext } from "../../llm/planContext.js";
import {
  FakeProvider,
  MemoryGenerationStore,
  MemoryPlanStore,
  makeContext,
} from "../../testFixtures/generationHarness.js";
import { baseContext } from "./promptContext.js";
import type { GeneratePlanInput } from "./types.js";

/**
 * Guards the rule in `AGENTS.md` that an optional prompt field is typed
 * `T | undefined` and forwarded, not conditionally spread. The scan covers the
 * modules that compose a plan prompt's context; the option objects in
 * `freshPlan.ts` and `revision.ts` are not prompt context and stay conditional.
 */
const CONDITIONAL_SPREAD =
  /\.\.\.\([\s\S]{0,200}?\?\s*\{[\s\S]{0,120}?\}\s*:\s*\{\s*\}\)/;
const CONTEXT_MODULES = ["promptContext.ts", "decision.ts", "../trigger.ts"];

function input(): GeneratePlanInput {
  return {
    userId: 1,
    runId: "run-1",
    today: "2026-10-21",
    plan: null,
    context: makeContext(new FakeProvider({})),
    plans: new MemoryPlanStore(null),
    generations: new MemoryGenerationStore(),
  };
}

describe("baseContext", () => {
  it("forwards every optional context field instead of omitting it", () => {
    const context = baseContext(input());

    expect(context).toMatchObject({
      currentForm: null,
      ftpHistory: undefined,
      thresholds: undefined,
      bodyHistory: undefined,
      dailyHealth: undefined,
      events: undefined,
      diet: undefined,
      dietGoal: undefined,
      dietAdvice: undefined,
      calorieHistory: undefined,
      timezone: undefined,
      manualActivities: [],
      activityComments: [],
      weeklyNote: null,
      weeklyNoteWeekStartDate: undefined,
      weeklyNoteReply: undefined,
      periodReviews: undefined,
    });
    // The prompt sees the same text whether a field is absent or undefined.
    expect(formatPlanContext(context)).toEqual(
      formatPlanContext({
        athleteAnswers: context.athleteAnswers,
        recentActivities: context.recentActivities,
        today: context.today,
      }),
    );
  });
});

describe("optional prompt context", () => {
  it("is forwarded instead of conditionally spread", () => {
    const offenders = CONTEXT_MODULES.filter((module) =>
      CONDITIONAL_SPREAD.test(
        readFileSync(join(import.meta.dir, module), "utf8"),
      ),
    );

    expect(offenders).toEqual([]);
  });
});
