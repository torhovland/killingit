import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, CoachPlan } from "@killingit/shared";
import {
  buildProgramAnalysisMessages,
  buildProgramAnalysisPrompt,
} from "./programAnalysisPrompt.js";
import { PLAIN_TEXT_RULES } from "./promptRules.js";

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

  it("uses a plain-text review system prompt", () => {
    const messages = buildProgramAnalysisMessages({
      today: "2026-10-21",
      plan: makePlan(),
      activity,
    });

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain(
      "Review one completed workout against the athlete's current training program",
    );
    expect(messages[0]?.content).toContain(PLAIN_TEXT_RULES);
    expect(messages[0]?.content).toContain("do not trust it");
    expect(messages[0]?.content).toContain("strength-training workout");
    expect(messages[0]?.content).toContain(
      "weave how well it fit the plan into one brief summary",
    );
  });
});
