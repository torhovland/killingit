import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity } from "@killingit/shared";
import {
  buildCoachPlanMessages,
  buildCoachPlanPrompt,
  COACH_PLAN_PROMPT_VERSION,
  COACH_PLAN_SYSTEM_PROMPT,
  toCoachPlanActivity,
  type CoachPlanInput,
} from "./coachPlanPrompt.js";
import {
  BIKE_WORKOUT_RULES,
  COMPLETED_SESSION_RULES,
  RATIONALE_RULES,
  WEEK_OUTLINE_RULES,
  WEATHER_PLANNING_RULES,
} from "./promptRules.js";

function makeInput(overrides: Partial<CoachPlanInput> = {}): CoachPlanInput {
  return {
    today: "2026-10-21",
    timezone: "Europe/Oslo",
    athleteAnswers: [
      {
        prompt: "What is your main goal?",
        answer: "Finish a sub-4-hour marathon next autumn.",
        skipped: false,
      },
      {
        prompt: "How many hours can you train per week?",
        answer: "About 6 hours.",
        skipped: false,
      },
      {
        prompt: "Any injuries or constraints?",
        answer: null,
        skipped: true,
      },
      {
        prompt: "What is your favourite session?",
        answer: null,
        skipped: false,
      },
    ],
    recentActivities: [
      {
        summary: {
          id: 1,
          name: "Morning Run",
          type: "running",
          startDate: "2026-10-20T06:30:00Z",
          distance: 10200,
          movingTime: 2700,
          elapsedTime: 2800,
          totalElevationGain: 120,
        },
        analysis: "Steady aerobic effort with a slight heart-rate drift.",
      },
      {
        summary: {
          id: 2,
          name: "Gym Session",
          type: "strength_training",
          startDate: "2026-10-18T18:00:00Z",
          distance: 0,
          movingTime: 3600,
          elapsedTime: 3900,
          totalElevationGain: 0,
        },
        analysis: null,
      },
    ],
    ...overrides,
  };
}

function makeAnalyzedActivity(
  overrides: Partial<AnalyzedActivity> = {},
): AnalyzedActivity {
  return {
    id: 1,
    name: "Morning Run",
    type: "running",
    startDate: "2026-10-20T06:30:00Z",
    distance: 10200,
    movingTime: 2700,
    elapsedTime: 2800,
    totalElevationGain: 120,
    sampleCount: 500,
    analysis: {
      text: "Steady aerobic effort with a slight heart-rate drift.",
      model: "openrouter/model",
      generatedAt: "2026-10-20T08:00:00Z",
    },
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}

describe("coach plan prompts", () => {
  it("exposes a prompt version for cache invalidation", () => {
    expect(COACH_PLAN_PROMPT_VERSION).toBe(10);
  });

  it("builds a system and a user message", () => {
    const messages = buildCoachPlanMessages(makeInput());

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "system",
      content: COACH_PLAN_SYSTEM_PROMPT,
    });
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Today's date: 2026-10-21");
  });

  it("requires state of the art training science and the four plan levels", () => {
    const prompt = COACH_PLAN_SYSTEM_PROMPT;

    expect(prompt).toContain("state of the art training science");
    expect(prompt).toContain("best possible plan");
    expect(prompt).toContain("season");
    expect(prompt).toContain("block");
    expect(prompt).toContain("week");
    expect(prompt).toContain("today");
  });

  it("defines the JSON response contract and how the levels fit together", () => {
    const prompt = COACH_PLAN_SYSTEM_PROMPT;

    expect(prompt).toContain("Return only a single valid JSON object");
    expect(prompt).toContain('"season"');
    expect(prompt).toContain('"block"');
    expect(prompt).toContain('"week"');
    expect(prompt).toContain('"today"');
    expect(prompt).toContain('"sessions"');
    expect(prompt).toContain('"weekCount"');
    expect(prompt).toContain('"targetLoad"');
    expect(prompt).toContain('"alternatives"');
    expect(prompt).toContain('"optional"');
    expect(prompt).toContain('"optionalRationale"');
    expect(prompt).toContain('"estimatedTss"');
    expect(prompt).toContain('"estimatedFtpWatts"');
    expect(prompt).toContain("training stress score");
    expect(prompt).toContain("what the athlete loses toward that goal");
    expect(prompt).toContain(
      "if you cannot state a concrete loss for skipping a planned session",
    );
    expect(prompt).toContain(
      "Revise the week so every workout serves the goal",
    );
    expect(prompt).toContain("exactly seven entries");
    expect(prompt).toContain(
      "block.weeks[0].startDate and week.startDate must match",
    );
    expect(prompt).toContain("today must match the entry for today's date");
    expect(prompt).toContain('use either "workout" or "rest"');
    expect(prompt).toContain(
      'never output a session name such as "run", "strength", or "rest day" as a type',
    );
    expect(prompt).toContain(
      "Every field must use the exact name and value type shown in the contract",
    );
    expect(prompt).toContain(WEEK_OUTLINE_RULES);
    expect(prompt).toContain(
      "Treat the week as an outline, not seven finished workouts",
    );
    expect(prompt).toContain(
      "Fully detail today's and tomorrow's sessions; keep every later day in the week as a short outline.",
    );
  });

  it("uses the same planning rules as the update prompt", () => {
    expect(COACH_PLAN_SYSTEM_PROMPT).toContain(WEATHER_PLANNING_RULES);
    expect(COACH_PLAN_SYSTEM_PROMPT).toContain(BIKE_WORKOUT_RULES);
    expect(COACH_PLAN_SYSTEM_PROMPT).toContain(RATIONALE_RULES);
    expect(COACH_PLAN_SYSTEM_PROMPT).toContain(COMPLETED_SESSION_RULES);
  });

  it("includes today's date, the timezone, and the athlete profile", () => {
    const prompt = buildCoachPlanPrompt(makeInput());

    expect(prompt).toContain("Today's date: 2026-10-21");
    expect(prompt).toContain("Athlete timezone: Europe/Oslo");
    expect(prompt).toContain(
      "- What is your main goal?: Finish a sub-4-hour marathon next autumn.",
    );
    expect(prompt).toContain(
      "- How many hours can you train per week?: About 6 hours.",
    );
  });

  it("marks explicitly skipped and unanswered questions", () => {
    const prompt = buildCoachPlanPrompt(makeInput());

    expect(prompt).toContain("- Any injuries or constraints?: (skipped)");
    expect(prompt).toContain(
      "- What is your favourite session?: (not answered)",
    );
  });

  it("includes recent activities with their coach analyses", () => {
    const prompt = buildCoachPlanPrompt(makeInput());

    expect(prompt).toContain(
      "1. 2026-10-20 — running — Morning Run: 10.20 km, 45:00 moving, 120 m elevation.",
    );
    expect(prompt).toContain(
      "Coach analysis: Steady aerobic effort with a slight heart-rate drift.",
    );
    expect(prompt).toContain(
      "2. 2026-10-18 — strength_training — Gym Session: 1:00:00 moving.",
    );
    expect(prompt).toContain("Coach analysis: not available.");
  });

  it("does not render distance or elevation when the activity has neither", () => {
    const prompt = buildCoachPlanPrompt(makeInput());

    expect(prompt).not.toContain("0.00 km");
    expect(prompt).not.toContain("Gym Session: 1:00:00 moving, 0 m elevation");
  });

  it("records when no activities were recorded", () => {
    const prompt = buildCoachPlanPrompt(makeInput({ recentActivities: [] }));

    expect(prompt).toContain("No recent activities were recorded.");
    expect(prompt).toContain("build the plan conservatively");
  });

  it("records when no interview answers were recorded", () => {
    const prompt = buildCoachPlanPrompt(makeInput({ athleteAnswers: [] }));

    expect(prompt).toContain("No interview answers were recorded.");
  });

  it("omits the timezone line when no timezone is known", () => {
    const prompt = buildCoachPlanPrompt({
      today: "2026-10-21",
      athleteAnswers: [],
      recentActivities: [],
    });

    expect(prompt).not.toContain("Athlete timezone:");
  });

  it("asks for state of the art training science in the user prompt", () => {
    const prompt = buildCoachPlanPrompt(makeInput());

    expect(prompt).toContain(
      "Use state of the art training science to make the best possible plan for this athlete.",
    );
    expect(prompt).toContain(
      'top-level keys are exactly "season", "block", "week", "today", "tomorrow", and "bodyMetrics"',
    );
  });
});

describe("toCoachPlanActivity", () => {
  it("maps an analyzed activity to its summary and analysis text", () => {
    const activity = makeAnalyzedActivity();
    const mapped = toCoachPlanActivity(activity);

    expect(mapped.summary).toBe(activity);
    expect(mapped.analysis).toBe(
      "Steady aerobic effort with a slight heart-rate drift.",
    );
  });

  it("maps a missing analysis to null", () => {
    const mapped = toCoachPlanActivity(
      makeAnalyzedActivity({ analysis: null }),
    );

    expect(mapped.analysis).toBeNull();
  });
});
