import { describe, expect, it } from "bun:test";
import type { BlockPlan, SeasonPlan, WeekPlan } from "@killingit/shared";
import { BODY_METRIC_RULES } from "./planContext.js";
import {
  BLOCK_UPDATE_SYSTEM_PROMPT,
  buildBlockUpdatePrompt,
  buildDailyUpdatePrompt,
  buildSeasonRefreshPrompt,
  buildWeeklyUpdatePrompt,
  DAILY_UPDATE_SYSTEM_PROMPT,
  SEASON_REFRESH_SYSTEM_PROMPT,
  WEATHER_PLANNING_RULES,
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
  manualActivities: [
    {
      id: 99,
      startDate: "2026-10-19",
      details: "Manual Swim",
    },
  ],
  activityComments: [
    { activityId: "123", comment: "Felt strong on the hills." },
  ],
  weeklyNote: "I cannot train on Thursday this week.",
};

describe("daily update prompts", () => {
  it("requires state of the art training science and a coherent day/week", () => {
    const prompt = DAILY_UPDATE_SYSTEM_PROMPT;
    expect(prompt).toContain("state of the art training science");
    expect(prompt).toContain("exactly seven sessions");
    expect(prompt).toContain("today object must match today's date");
    expect(prompt).toContain(
      "today's plan must describe that completed activity",
    );
    expect(prompt).toContain("do not propose new workouts");
    expect(prompt).toContain("rationale");
    expect(prompt).toContain("status");
    expect(prompt).toContain("partial");
    expect(prompt).toContain("a 60-minute ride recorded as 50 minutes");
    expect(prompt).toContain('"today"');
    expect(prompt).toContain('"tomorrow"');
    expect(prompt).toContain('"week"');
    expect(prompt).toContain('"alternatives"');
    expect(prompt).toContain('"optional"');
    expect(prompt).toContain('"optionalRationale"');
    expect(prompt).toContain('"bikeWorkout"');
    expect(prompt).toContain('"powerPercent"');
    expect(prompt).toContain('set "bikeWorkout" to null');
    expect(prompt).toContain('"estimatedTss"');
    expect(prompt).toContain("training stress score");
    expect(prompt).toContain('"estimatedFtpWatts"');
    expect(prompt).toContain('"bodyMetrics"');
    expect(prompt).toContain('"weightKg"');
    expect(prompt).toContain('"bodyFatPercent"');
    expect(prompt).toContain(BODY_METRIC_RULES);
    expect(prompt).toContain("what the athlete loses toward that goal");
    expect(prompt).toContain(
      "if you cannot state a concrete loss for skipping a planned session",
    );
    expect(prompt).toContain(
      "Revise the week so every workout serves the goal",
    );
  });

  it("includes the profile, activities, season, block, and week", () => {
    const prompt = buildDailyUpdatePrompt({ ...base, season, block, week });

    expect(prompt).toContain("Today's date: 2026-10-21");
    expect(prompt).toContain("Athlete timezone: Europe/Oslo");
    expect(prompt).toContain("Finish a sub-4-hour marathon.");
    expect(prompt).toContain("Morning Run");
    expect(prompt).toContain("Steady aerobic effort.");
    expect(prompt).toContain("Manually recorded activities:");
    expect(prompt).toContain("Manual Swim");
    expect(prompt).toContain("Activity comments:");
    expect(prompt).toContain("Felt strong on the hills.");
    expect(prompt).toContain("Weekly note:");
    expect(prompt).toContain("I cannot train on Thursday this week.");
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Block: Base");
    expect(prompt).toContain("Week starting 2026-10-19");
    expect(prompt).toContain("Easy run");
    expect(prompt).toContain(
      'top-level keys are exactly "today", "tomorrow", "week", and "bodyMetrics"',
    );
  });

  it("asks the coach to respect weather and daylight and classify indoor/outdoor sessions", () => {
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain(WEATHER_PLANNING_RULES);
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain('"outdoor"');
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain('"canBeOutdoor"');
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain(
      "could reasonably be done outdoors",
    );
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain("not ride outdoors in rain");
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain("prefers daylight");
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain("train in the dark");
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain("before or after work");
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain("long outdoor sessions");
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain("weekend");
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain("dry");
  });

  it("requires the exact enum values from the schema", () => {
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain(
      'never output a session name such as "run", "strength", or "rest day" as a type',
    );
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain(
      "Every field must use the exact name and value type shown in the contract",
    );
    expect(WEEKLY_UPDATE_SYSTEM_PROMPT).toContain(
      'never output a session name such as "run", "strength", or "rest day" as a type',
    );
    expect(WEEKLY_UPDATE_SYSTEM_PROMPT).toContain(
      "Every field must use the exact name and value type shown in the contract",
    );
  });

  it("states the exact week and today dates", () => {
    const prompt = buildDailyUpdatePrompt({
      ...base,
      season,
      block,
      week,
    });

    expect(prompt).toContain(
      "The week must start on 2026-10-19 and cover 2026-10-19 through 2026-10-25.",
    );
    expect(prompt).toContain("one session has the date 2026-10-21");
    expect(prompt).toContain('the "today" object must use that same date');
  });

  it("includes the forecast when one is supplied", () => {
    const prompt = buildDailyUpdatePrompt({
      ...base,
      season,
      block,
      week,
      locationName: "Oslo",
      forecast: [
        {
          date: "2026-10-21",
          icon: "rain",
          temperatureMaxC: 9,
          temperatureMinC: 5,
          windMaxMs: 4,
          gustMaxMs: 8,
          precipitationMm: 2,
          sunrise: "07:45",
          sunset: "16:30",
        },
      ],
    });

    expect(prompt).toContain(
      "Combined daily weather and daylight forecast for Oslo",
    );
    expect(prompt).toContain("Rain (rain)");
    expect(prompt).toContain("sunrise 07:45, sunset 16:30");
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
    expect(prompt).toContain("partial");
    expect(prompt).toContain("Allow reasonable slack");
    expect(prompt).toContain('"week"');
    expect(prompt).toContain('"block"');
    expect(prompt).toContain('"bikeWorkout"');
    expect(prompt).toContain('"powerPercent"');
    expect(prompt).toContain('"estimatedTss"');
    expect(prompt).toContain('"estimatedFtpWatts"');
    expect(prompt).toContain('"bodyMetrics"');
    expect(prompt).toContain(BODY_METRIC_RULES);
    expect(prompt).toContain("training stress score");
  });

  it("includes the week start date and the current block", () => {
    const prompt = buildWeeklyUpdatePrompt({
      ...base,
      season,
      block,
      weekStartDate: "2026-10-26",
    });

    expect(prompt).toContain(
      "Week start date: 2026-10-26. The week must contain exactly seven sessions dated 2026-10-26 through 2026-11-01.",
    );
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Block: Base");
    expect(prompt).toContain("Aerobic base + strides");
    expect(prompt).toContain(
      'top-level keys are exactly "week", "block", and "bodyMetrics"',
    );
  });

  it("asks the coach to place sessions around the weather and daylight", () => {
    expect(WEEKLY_UPDATE_SYSTEM_PROMPT).toContain(WEATHER_PLANNING_RULES);
    expect(WEEKLY_UPDATE_SYSTEM_PROMPT).toContain(
      "Saturday is sunny and Sunday is rainy",
    );
    expect(WEEKLY_UPDATE_SYSTEM_PROMPT).toContain("prefers daylight");
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
    expect(prompt).toContain(
      'top-level keys are exactly "block", "season", and "bodyMetrics"',
    );
  });
});

describe("season refresh prompt", () => {
  it("asks to refresh the current block in place and re-plan the future", () => {
    const prompt = SEASON_REFRESH_SYSTEM_PROMPT;
    expect(prompt).toContain("state of the art training science");
    expect(prompt).toContain("Refresh the block that contains today");
    expect(prompt).toContain("keep its existing start date");
    expect(prompt).toContain("ended before today");
    expect(prompt).toContain("without gaps");
    expect(prompt).toContain('"block"');
    expect(prompt).toContain('"season"');
  });

  it("includes the existing season, current block, and its start date", () => {
    const prompt = buildSeasonRefreshPrompt({ ...base, season, block });

    expect(prompt).toContain("Today's date: 2026-10-21");
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Block: Base");
    expect(prompt).toContain(
      "The current block already started on 2026-10-21; keep that start date",
    );
    expect(prompt).toContain("Finish a sub-4-hour marathon.");
    expect(prompt).toContain(
      'top-level keys are exactly "block", "season", and "bodyMetrics"',
    );
  });
});
