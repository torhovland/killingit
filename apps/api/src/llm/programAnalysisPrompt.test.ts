import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, CoachPlan } from "@killingit/shared";
import {
  buildProgramAnalysisMessages,
  buildProgramAnalysisPrompt,
} from "./programAnalysisPrompt.js";
import {
  ACTIVITY_EXTRA_PRAISE_RULES,
  ACTIVITY_PRAISE_RULES,
  GLOBAL_PROMPT_RULES,
  TEXT_FORMATTING_RULES,
} from "./promptRules.js";

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Sub-4-hour marathon",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      rationale: "Build aerobic base before marathon-specific work.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic endurance",
          startDate: "2026-10-19",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic endurance",
      rationale: "Establish consistent aerobic volume.",
      startDate: "2026-10-19",
      endDate: "2026-12-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic base",
          targetLoad: "Easy",
        },
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic base",
      rationale: "Keep the week easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout" as const,
        title: index === 0 ? "Easy aerobic run" : `Session ${index + 1}`,
        description: "Easy aerobic work.",
        durationMinutes: 45,
        intensity: "easy" as const,
        status: "planned" as const,
      })),
    },
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
}

const activity: AnalyzedActivity = {
  id: 42,
  name: "Morning Run",
  type: "running",
  startDate: "2026-10-19T06:30:00Z",
  distance: 10200,
  movingTime: 2700,
  elapsedTime: 2800,
  totalElevationGain: 120,
  sampleCount: 500,
  samples: [],
  analysis: {
    text: "Steady aerobic effort with a slight heart-rate drift.",
    model: "openrouter/model",
    generatedAt: "2026-10-19T08:00:00Z",
  },
  analysisError: null,
  programAnalysis: null,
  comment: null,
  coachReply: null,
};

describe("buildProgramAnalysisMessages", () => {
  it("includes the plan, the planned session, the activity, and the comment", () => {
    const prompt = buildProgramAnalysisPrompt({
      today: "2026-10-21",
      plan: makePlan(),
      activity,
      comment: "Felt strong on the hills.",
    });

    expect(prompt).toContain("Sub-4-hour marathon");
    expect(prompt).toContain("Aerobic endurance");
    expect(prompt).toContain(
      "Planned session for 2026-10-19: Easy aerobic run",
    );
    expect(prompt).toContain("Morning Run");
    expect(prompt).toContain("10.20 km");
    expect(prompt).toContain("Steady aerobic effort");
    expect(prompt).toContain("Felt strong on the hills.");
    expect(prompt).toContain("what could be done better");
    expect(prompt).toContain("how well this activity fit its planned session");
  });

  it("includes stored weigh-ins with their sources", () => {
    const prompt = buildProgramAnalysisPrompt({
      today: "2026-10-21",
      plan: makePlan(),
      activity,
      bodyHistory: {
        weight: [
          { date: "2026-10-18", value: 78.5, source: "garmin" },
          { date: "2026-10-20", value: 78, source: "user" },
        ],
        bodyFat: [],
      },
    });

    expect(prompt).toContain("- 2026-10-18: 78.5 kg (garmin)");
    expect(prompt).not.toContain("- 2026-10-20: 78.0 kg (user)");
  });

  it("does not treat a near-target duration as short or long", () => {
    const messages = buildProgramAnalysisMessages({
      today: "2026-10-21",
      plan: makePlan(),
      activity,
    });

    expect(messages[0]?.content).toContain(
      "a two-hour session recorded as 1:50 or 2:05 matched its plan",
    );
    expect(messages[0]?.content).toContain(
      "build on it instead of inventing a correction",
    );
  });

  it("asks the coach to match against another session when the date has none", () => {
    const prompt = buildProgramAnalysisPrompt({
      today: "2026-10-30",
      plan: makePlan(),
      activity: { ...activity, startDate: "2026-10-30T06:30:00Z" },
    });

    expect(prompt).toContain("No session was planned for 2026-10-30");
    expect(prompt).toContain(
      "Match the activity to another session in this week if its data fits one.",
    );
  });

  it("praises a well-performed race or extraordinary effort", () => {
    const messages = buildProgramAnalysisMessages({
      today: "2026-10-21",
      plan: makePlan(),
      activity,
    });

    expect(messages[0]?.content).toContain(ACTIVITY_PRAISE_RULES);
    expect(messages[0]?.content).toContain(
      "tell them plainly that they are killing it",
    );
  });

  it("adds the extra praise when the draw is 0", () => {
    const messages = buildProgramAnalysisMessages(
      {
        today: "2026-10-21",
        plan: makePlan(),
        activity,
      },
      () => 0,
    );

    expect(messages[1]?.content).toContain(ACTIVITY_EXTRA_PRAISE_RULES);
  });

  it("leaves out the extra praise for any other draw", () => {
    const prompt = buildProgramAnalysisPrompt(
      {
        today: "2026-10-21",
        plan: makePlan(),
        activity,
      },
      () => 14 / 15,
    );

    expect(prompt).not.toContain(ACTIVITY_EXTRA_PRAISE_RULES);
  });

  it("uses a formatted-text review system prompt", () => {
    const messages = buildProgramAnalysisMessages({
      today: "2026-10-21",
      plan: makePlan(),
      activity,
    });

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain(
      "Review one completed workout against the athlete's current training program",
    );
    expect(messages[0]?.content).toContain(TEXT_FORMATTING_RULES);
    expect(messages[0]?.content).toContain(GLOBAL_PROMPT_RULES);
    expect(messages[0]?.content).toContain("do not trust it");
    expect(messages[0]?.content).toContain("strength-training workout");
    expect(messages[0]?.content).toContain(
      "weave how well it fit the plan into one brief summary",
    );
  });
});
