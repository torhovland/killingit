import { describe, expect, it } from "bun:test";
import type { BlockPlan, SeasonPlan, WeekPlan } from "@killingit/shared";
import {
  BLOCK_UPDATE_SYSTEM_PROMPT,
  buildBlockUpdatePrompt,
  buildDailyUpdatePrompt,
  buildWeeklyUpdatePrompt,
  DAILY_UPDATE_SYSTEM_PROMPT,
  WEEKLY_UPDATE_SYSTEM_PROMPT,
} from "./planUpdatePrompt.js";

const answers = [
  {
    prompt: "What is your main goal?",
    answer: "Finish a sub-4-hour marathon.",
    skipped: false,
  },
  {
    prompt: "Any injuries?",
    answer: null,
    skipped: true,
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
    {
      name: "Build",
      focus: "Threshold and race pace",
      startDate: "2026-12-02",
      endDate: "2027-02-01",
      weekCount: 8,
    },
  ],
};

const block: BlockPlan = {
  name: "Base",
  focus: "Aerobic endurance",
  rationale: "Establish consistent volume.",
  startDate: "2026-10-21",
  endDate: "2026-12-01",
  weeks: [
    {
      number: 1,
      startDate: "2026-10-19",
      focus: "Aerobic base",
      targetLoad: "Easy",
    },
    {
      number: 2,
      startDate: "2026-10-26",
      focus: "Aerobic base + strides",
      targetLoad: "Easy to moderate",
    },
  ],
};

const week: WeekPlan = {
  startDate: "2026-10-19",
  focus: "Aerobic base",
  rationale: "Keep the week easy.",
  sessions: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-10-${String(19 + index)}`,
    day: "Monday",
    type: "workout" as const,
    title: index === 2 ? "Easy run" : `Session ${index + 1}`,
    description: "Easy aerobic work.",
    durationMinutes: 45,
    intensity: "easy" as const,
    status: "planned" as const,
  })),
};

const base = {
  today: "2026-10-21",
  timezone: "Europe/Oslo",
  athleteAnswers: answers,
  recentActivities: activities,
};

describe("daily update prompts", () => {
  it("requires state of the art training science and a coherent day/week", () => {
    const prompt = DAILY_UPDATE_SYSTEM_PROMPT;
    expect(prompt).toContain("state of the art training science");
    expect(prompt).toContain("exactly seven sessions");
    expect(prompt).toContain("today object must match today's date");
    expect(prompt).toContain("do not propose new workouts");
    expect(prompt).toContain("rationale");
    expect(prompt).toContain("status");
    expect(prompt).toContain('"today"');
    expect(prompt).toContain('"tomorrow"');
    expect(prompt).toContain('"week"');
    expect(prompt).toContain('"alternatives"');
    expect(prompt).toContain('"optional"');
    expect(prompt).toContain('"optionalRationale"');
    expect(prompt).toContain("can be skipped without undermining the plan");
  });

  it("includes the profile, activities, season, block, and week", () => {
    const prompt = buildDailyUpdatePrompt({ ...base, season, block, week });

    expect(prompt).toContain("Today's date: 2026-10-21");
    expect(prompt).toContain("Athlete timezone: Europe/Oslo");
    expect(prompt).toContain("Finish a sub-4-hour marathon.");
    expect(prompt).toContain("Morning Run");
    expect(prompt).toContain("Steady aerobic effort.");
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Block: Base");
    expect(prompt).toContain("Week starting 2026-10-19");
    expect(prompt).toContain("Easy run");
  });
});

describe("weekly update prompts", () => {
  it("requires a new week and a revised block", () => {
    const prompt = WEEKLY_UPDATE_SYSTEM_PROMPT;
    expect(prompt).toContain("state of the art training science");
    expect(prompt).toContain("exactly seven sessions");
    expect(prompt).toContain("Revise the block's weeks and target loads");
    expect(prompt).toContain("do not propose new workouts");
    expect(prompt).toContain("rationale");
    expect(prompt).toContain("status");
    expect(prompt).toContain('"week"');
    expect(prompt).toContain('"block"');
  });

  it("includes the week start date and the current block", () => {
    const prompt = buildWeeklyUpdatePrompt({
      ...base,
      season,
      block,
      weekStartDate: "2026-10-26",
    });

    expect(prompt).toContain("Week start date: 2026-10-26");
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Block: Base");
    expect(prompt).toContain("Aerobic base + strides");
  });
});

describe("block update prompts", () => {
  it("requires a new block and a revised season", () => {
    const prompt = BLOCK_UPDATE_SYSTEM_PROMPT;
    expect(prompt).toContain("state of the art training science");
    expect(prompt).toContain("Create the next block");
    expect(prompt).toContain("Revise the season plan");
    expect(prompt).toContain("rationale");
    expect(prompt).toContain('"block"');
    expect(prompt).toContain('"season"');
  });

  it("includes the next block start date and the completed block", () => {
    const prompt = buildBlockUpdatePrompt({
      ...base,
      season,
      block,
      nextBlockStartDate: "2026-12-02",
    });

    expect(prompt).toContain("Next block start date: 2026-12-02");
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Completed block plan:");
    expect(prompt).toContain("Block: Base");
  });
});
