import { describe, expect, it } from "bun:test";
import type { SeasonPlan } from "@killingit/shared";
import {
  buildInitialBlockMessages,
  buildSeasonPlanMessages,
  type InitialBlockInput,
  type SeasonPlanInput,
} from "./planInitialPrompt.js";
import {
  GLOBAL_PROMPT_RULES,
  PLAN_PROMPT_RULES,
  SEASON_BLOCK_RULES,
  SEASON_INTRODUCTION_RULES,
  TRAINING_LOAD_RULES,
} from "./promptRules.js";

const answers = [
  {
    prompt: "What is your main goal?",
    answer: "Finish a sub-4-hour marathon.",
    skipped: false,
  },
];

const activities = [
  {
    summary: {
      id: 1,
      name: "Morning Run",
      type: "running",
      startDate: "2026-10-20T06:30:00Z",
      distance: 10000,
      movingTime: 2700,
      elapsedTime: 2800,
      totalElevationGain: 80,
    },
    analysis: "Steady aerobic effort.",
  },
];

const season: SeasonPlan = {
  goal: "Sub-4-hour marathon",
  startDate: "2026-10-21",
  endDate: "2027-04-01",
  rationale: "Build a strong aerobic base.",
  goals: [
    {
      title: "Sub-4-hour marathon",
      date: "2027-04-01",
      priority: "A",
      target: "Under 4:00",
    },
  ],
  blocks: [
    {
      name: "Base",
      focus: "Aerobic endurance",
      startDate: "2026-10-21",
      endDate: "2026-12-01",
      weekCount: 6,
      subGoals: [
        {
          goalTitle: "Sub-4-hour marathon",
          goalDate: "2027-04-01",
          role: "build",
          target: "Six consistent weeks of aerobic running",
          byDate: "2026-11-30",
        },
      ],
    },
  ],
};

const base = {
  today: "2026-10-21",
  timezone: "Europe/Oslo",
  athleteAnswers: answers,
  recentActivities: activities,
};

function seasonSystemPrompt(): string {
  return buildSeasonPlanMessages(base)[0]?.content ?? "";
}

/** The user message the app sends for a season plan. */
function seasonUserPrompt(input: SeasonPlanInput = base): string {
  return buildSeasonPlanMessages(input)[1]?.content ?? "";
}

function blockSystemPrompt(): string {
  return buildInitialBlockMessages({ ...base, season })[0]?.content ?? "";
}

/** The user message the app sends for the first block. */
function blockUserPrompt(input: InitialBlockInput): string {
  return buildInitialBlockMessages(input)[1]?.content ?? "";
}

describe("season plan prompt", () => {
  it("requires state of the art training science and a JSON season", () => {
    const system = seasonSystemPrompt();

    expect(system).toContain("state of the art training science");
    expect(system).toContain("season");
    expect(system).toContain('"season"');
    expect(system).toContain('"weekCount"');
    expect(system).toContain('"goals"');
    expect(system).toContain('"subGoals"');
    expect(system).toContain("rationale");
    expect(system).toContain('"dietProgress"');
    expect(system).toContain('"targetWeightKg"');
  });

  it("opens the season with a greeting from the coach", () => {
    expect(seasonSystemPrompt()).toContain(SEASON_INTRODUCTION_RULES);
    expect(seasonSystemPrompt()).toContain('"introduction"');
  });

  it("includes the athlete context and today's date", () => {
    const prompt = seasonUserPrompt();

    expect(prompt).toContain("Today's date: 2026-10-21");
    expect(prompt).toContain("Athlete timezone: Europe/Oslo");
    expect(prompt).toContain("Finish a sub-4-hour marathon.");
    expect(prompt).toContain("Steady aerobic effort.");
    expect(prompt).toContain("Create the season plan.");
    expect(prompt).toContain(
      'top-level keys are exactly "season" and "bodyMetrics"',
    );
  });

  it("uses the shared input, rationale and body-metric rules", () => {
    expect(seasonSystemPrompt()).toContain(GLOBAL_PROMPT_RULES);
    expect(seasonSystemPrompt()).toContain(PLAN_PROMPT_RULES);
  });

  it("tiles the season's blocks with the shared rule", () => {
    expect(seasonSystemPrompt()).toContain(SEASON_BLOCK_RULES);
  });
});

describe("initial block prompt", () => {
  it("requires the first block and tells the model to keep the season", () => {
    const system = blockSystemPrompt();

    expect(system).toContain("state of the art training science");
    expect(system).toContain("first block");
    expect(system).toContain("Keep the season unchanged");
    expect(system).toContain('"block"');
    expect(system).toContain('"subGoals"');
    expect(system).toContain('"targetLoad"');
    expect(system).toContain("rationale");
    expect(system).toContain('"dietProgress"');
    expect(system).toContain('"targetBodyFatPercent"');
    expect(system).toContain(PLAN_PROMPT_RULES);
    expect(system).toContain(GLOBAL_PROMPT_RULES);
    expect(system).toContain(TRAINING_LOAD_RULES);
  });

  it("includes the season plan and the athlete context", () => {
    const prompt = blockUserPrompt({ ...base, season });

    expect(prompt).toContain("Today's date: 2026-10-21");
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Goals:");
    expect(prompt).toContain("Sub-goals:");
    expect(prompt).toContain("Base");
    expect(prompt).toContain("Create the first block.");
    expect(prompt).toContain(
      'top-level keys are exactly "block" and "bodyMetrics"',
    );
  });
});
