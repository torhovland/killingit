import { describe, expect, it } from "bun:test";
import type { SeasonPlan } from "@killingit/shared";
import {
  buildInitialBlockPrompt,
  buildSeasonPlanPrompt,
  INITIAL_BLOCK_SYSTEM_PROMPT,
  SEASON_PLAN_SYSTEM_PROMPT,
} from "./planInitialPrompt.js";

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
  blocks: [
    {
      name: "Base",
      focus: "Aerobic endurance",
      startDate: "2026-10-21",
      endDate: "2026-12-01",
      weekCount: 6,
    },
  ],
};

const base = {
  today: "2026-10-21",
  timezone: "Europe/Oslo",
  athleteAnswers: answers,
  recentActivities: activities,
};

describe("season plan prompt", () => {
  it("requires state of the art training science and a JSON season", () => {
    expect(SEASON_PLAN_SYSTEM_PROMPT).toContain(
      "state of the art training science",
    );
    expect(SEASON_PLAN_SYSTEM_PROMPT).toContain("season");
    expect(SEASON_PLAN_SYSTEM_PROMPT).toContain('"season"');
    expect(SEASON_PLAN_SYSTEM_PROMPT).toContain('"weekCount"');
    expect(SEASON_PLAN_SYSTEM_PROMPT).toContain("rationale");
  });

  it("includes the athlete context and today's date", () => {
    const prompt = buildSeasonPlanPrompt(base);

    expect(prompt).toContain("Today's date: 2026-10-21");
    expect(prompt).toContain("Athlete timezone: Europe/Oslo");
    expect(prompt).toContain("Finish a sub-4-hour marathon.");
    expect(prompt).toContain("Steady aerobic effort.");
    expect(prompt).toContain("Create the season plan.");
    expect(prompt).toContain(
      'top-level keys are exactly "season" and "bodyMetrics"',
    );
  });
});

describe("initial block prompt", () => {
  it("requires the first block and tells the model to keep the season", () => {
    expect(INITIAL_BLOCK_SYSTEM_PROMPT).toContain(
      "state of the art training science",
    );
    expect(INITIAL_BLOCK_SYSTEM_PROMPT).toContain("first block");
    expect(INITIAL_BLOCK_SYSTEM_PROMPT).toContain("Keep the season unchanged");
    expect(INITIAL_BLOCK_SYSTEM_PROMPT).toContain('"block"');
    expect(INITIAL_BLOCK_SYSTEM_PROMPT).toContain('"targetLoad"');
    expect(INITIAL_BLOCK_SYSTEM_PROMPT).toContain("rationale");
  });

  it("includes the season plan and the athlete context", () => {
    const prompt = buildInitialBlockPrompt({ ...base, season });

    expect(prompt).toContain("Today's date: 2026-10-21");
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Base");
    expect(prompt).toContain("Create the first block.");
    expect(prompt).toContain(
      'top-level keys are exactly "block" and "bodyMetrics"',
    );
  });
});
