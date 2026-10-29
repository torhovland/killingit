import { describe, expect, it } from "bun:test";
import type { BlockPlan, CoachPlan, WeekPlan } from "@killingit/shared";
import {
  buildPeriodReviewMessages,
  buildPeriodReviewPrompt,
  PERIOD_REVIEW_PROMPT_VERSION,
} from "./periodReviewPrompt.js";
import type { PlanContextInput } from "./planContext.js";
import { GLOBAL_PROMPT_RULES } from "./promptRules.js";

const week: WeekPlan = {
  startDate: "2026-10-13",
  focus: "Aerobic consistency",
  rationale: "Build a steady base.",
  sessions: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-10-${String(13 + index)}`,
    day: "Monday",
    type: "workout",
    title: `Session ${index + 1}`,
    description: "Easy aerobic work.",
    durationMinutes: 45,
    intensity: "easy",
    status: "completed",
  })),
};

const block: BlockPlan = {
  name: "Base",
  focus: "Aerobic endurance",
  startDate: "2026-10-01",
  endDate: "2026-10-28",
  rationale: "Establish consistent aerobic volume.",
  weeks: [
    {
      number: 1,
      startDate: "2026-10-05",
      focus: "Aerobic base",
      targetLoad: "Easy",
    },
  ],
};

const plan: CoachPlan = {
  season: {
    goal: "Sub-4-hour marathon",
    startDate: "2026-10-01",
    endDate: "2027-04-01",
    rationale: "Build aerobic base before marathon-specific work.",
    blocks: [
      {
        name: "Base",
        focus: "Aerobic endurance",
        startDate: "2026-10-01",
        endDate: "2026-10-28",
        weekCount: 4,
      },
    ],
  },
  block,
  week,
  today: {
    date: "2026-10-21",
    type: "workout",
    title: "Easy run",
    description: "45 minutes easy.",
    durationMinutes: 45,
    intensity: "easy",
    alternatives: [],
    rationale: "Easy aerobic work.",
    optional: false,
    status: "planned",
  },
  tomorrow: null,
  nextWeek: null,
  nextBlock: null,
};

const context: PlanContextInput = {
  athleteAnswers: [
    { prompt: "Goal", answer: "Run a marathon", skipped: false },
  ],
  recentActivities: [],
  today: "2026-10-21",
  periodReviews: [],
};

describe("buildPeriodReviewPrompt", () => {
  it("includes the completed week and asks for a plain-text summary", () => {
    const prompt = buildPeriodReviewPrompt({
      context,
      today: "2026-10-21",
      kind: "week",
      plan,
      startDate: "2026-10-13",
      endDate: "2026-10-19",
      title: "Week starting 2026-10-13",
      week,
    });

    expect(prompt).toContain(
      "Completed week: Week starting 2026-10-13 (2026-10-13 → 2026-10-19)",
    );
    expect(prompt).toContain("Completed week plan:");
    expect(prompt).toContain("Session 7");
    expect(prompt).toContain(
      "Write the coach summary for this completed week.",
    );
  });

  it("includes the completed block and the season", () => {
    const prompt = buildPeriodReviewPrompt({
      context,
      today: "2026-10-29",
      kind: "block",
      plan,
      startDate: "2026-10-01",
      endDate: "2026-10-28",
      title: "Base",
      block,
    });

    expect(prompt).toContain("Completed block: Base");
    expect(prompt).toContain("Completed block plan:");
    expect(prompt).toContain("Season plan:");
  });

  it("starts with the shared global prompt rules", () => {
    const messages = buildPeriodReviewMessages({
      context,
      today: "2026-10-19",
      kind: "week",
      plan,
      startDate: "2026-10-13",
      endDate: "2026-10-19",
      title: "Week starting 2026-10-13",
      week,
    });

    expect(messages[0]?.content).toContain(GLOBAL_PROMPT_RULES);
  });

  it("has a stable prompt version", () => {
    expect(PERIOD_REVIEW_PROMPT_VERSION).toBe(1);
  });
});
