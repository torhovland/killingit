import { describe, expect, it } from "bun:test";
import type {
  BlockPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { missingFragments } from "../testFixtures/prompts.js";
import {
  BIKE_WORKOUT_RULES,
  BLOCK_CONTRACT,
  BODY_METRIC_POINT_CONTRACT,
  COACH_RESPONSE_NOTES_CONTRACT,
  COACHING_SURVEY_ADJUSTMENT_RULES,
  COMPLETED_SESSION_RULES,
  COMPLETION_SLACK_RULES,
  DAY_CONTRACT,
  DIET_CONTRACT,
  DIET_PLANNING_RULES,
  DIET_PROGRESS_RULES,
  ENUM_RULES,
  GLOBAL_PROMPT_RULES,
  JSON_RULES,
  PAST_SESSION_RULES,
  PLAN_PROMPT_RULES,
  SEASON_BLOCK_RULES,
  SEASON_CONTRACT,
  SESSION_PURPOSE_RULES,
  TODAY_IN_WEEK_RULE,
  TRAINING_LOAD_RULES,
  WEEK_CONTRACT,
  weekDatesRangeRule,
  weekDatesRule,
  WEEKLY_NOTE_SCOPE_RULE,
  WEEK_OUTLINE_RULES,
  WEEK_SHAPE_RULES,
  WEATHER_PLANNING_RULES,
} from "./promptRules.js";
import {
  buildDailyUpdatePrompt,
  buildPlanUpdatePrompt,
  buildWeeklyUpdatePrompt,
  DAILY_UPDATE_SYSTEM_PROMPT,
  PLAN_UPDATE_SYSTEM_PROMPT,
  WEEKLY_UPDATE_SYSTEM_PROMPT,
  type PlanUpdateInput,
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
  weeklyNoteWeekStartDate: "2026-10-19",
  weeklyNoteReply: "Understood; Thursday is a rest day.",
};

const todayPlan: DayPlan = {
  date: "2026-10-21",
  type: "workout",
  title: "Easy run",
  description: "Easy aerobic work.",
  durationMinutes: 45,
  intensity: "easy",
  alternatives: ["Rest"],
  rationale: "Keep the week easy.",
  optional: false,
  status: "planned",
};

function updateInput(
  overrides: Partial<PlanUpdateInput> = {},
): PlanUpdateInput {
  return {
    ...base,
    season,
    block,
    week,
    todayPlan,
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    revision: {
      season: false,
      block: false,
      week: false,
      day: false,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      progress: false,
    },
    ...overrides,
  };
}

/**
 * The fragments each update prompt composes. A prompt that drops a shared rule,
 * or that stops carrying a contract, fails here without pinning any wording.
 */
const SYSTEM_PROMPTS = [
  {
    name: "daily update",
    prompt: DAILY_UPDATE_SYSTEM_PROMPT,
    fragments: [
      GLOBAL_PROMPT_RULES,
      PLAN_PROMPT_RULES,
      WEEK_SHAPE_RULES,
      TODAY_IN_WEEK_RULE,
      COMPLETED_SESSION_RULES,
      WEEK_OUTLINE_RULES,
      SESSION_PURPOSE_RULES,
      WEATHER_PLANNING_RULES,
      BIKE_WORKOUT_RULES,
      DIET_PLANNING_RULES,
      DIET_PROGRESS_RULES,
      TRAINING_LOAD_RULES,
      ENUM_RULES,
      JSON_RULES,
      DAY_CONTRACT,
      WEEK_CONTRACT,
      DIET_CONTRACT,
      BODY_METRIC_POINT_CONTRACT,
      COACH_RESPONSE_NOTES_CONTRACT,
    ],
  },
  {
    name: "weekly update",
    prompt: WEEKLY_UPDATE_SYSTEM_PROMPT,
    fragments: [
      GLOBAL_PROMPT_RULES,
      PLAN_PROMPT_RULES,
      WEEK_SHAPE_RULES,
      PAST_SESSION_RULES,
      COMPLETION_SLACK_RULES,
      WEEK_OUTLINE_RULES,
      WEATHER_PLANNING_RULES,
      BIKE_WORKOUT_RULES,
      DIET_PLANNING_RULES,
      DIET_PROGRESS_RULES,
      TRAINING_LOAD_RULES,
      ENUM_RULES,
      JSON_RULES,
      WEEK_CONTRACT,
      BLOCK_CONTRACT,
      BODY_METRIC_POINT_CONTRACT,
      COACH_RESPONSE_NOTES_CONTRACT,
    ],
  },
  {
    name: "plan update",
    prompt: PLAN_UPDATE_SYSTEM_PROMPT,
    fragments: [
      GLOBAL_PROMPT_RULES,
      PLAN_PROMPT_RULES,
      SEASON_BLOCK_RULES,
      WEEK_SHAPE_RULES,
      TODAY_IN_WEEK_RULE,
      COMPLETED_SESSION_RULES,
      WEEK_OUTLINE_RULES,
      SESSION_PURPOSE_RULES,
      COACHING_SURVEY_ADJUSTMENT_RULES,
      WEATHER_PLANNING_RULES,
      BIKE_WORKOUT_RULES,
      DIET_PLANNING_RULES,
      DIET_PROGRESS_RULES,
      TRAINING_LOAD_RULES,
      ENUM_RULES,
      JSON_RULES,
      SEASON_CONTRACT,
      BLOCK_CONTRACT,
      WEEK_CONTRACT,
      DAY_CONTRACT,
      DIET_CONTRACT,
      BODY_METRIC_POINT_CONTRACT,
      COACH_RESPONSE_NOTES_CONTRACT,
    ],
  },
];

describe("update system prompts", () => {
  it("starts with the global rules", () => {
    for (const { name, prompt } of SYSTEM_PROMPTS) {
      expect({
        name,
        startsWithGlobal: prompt.startsWith(GLOBAL_PROMPT_RULES),
      }).toEqual({ name, startsWithGlobal: true });
    }
  });

  it("composes every shared fragment and contract its prompt needs", () => {
    for (const { name, prompt, fragments } of SYSTEM_PROMPTS) {
      expect({ name, missing: missingFragments(prompt, fragments) }).toEqual({
        name,
        missing: [],
      });
    }
  });
});

describe("unified plan update prompt", () => {
  it("receives every level and asks for the requested levels in one response", () => {
    const prompt = buildPlanUpdatePrompt(
      updateInput({
        revision: {
          ...updateInput().revision,
          block: true,
          week: true,
          day: true,
        },
        nextWeek: { ...week, startDate: "2026-10-26" },
        nextBlock: { ...block, startDate: "2026-11-02", endDate: "2026-12-01" },
      }),
    );

    for (const label of [
      "Current season plan:",
      "Current block plan:",
      "Current week plan:",
      "Today's plan:",
      "Tomorrow's plan:",
      "Next week plan:",
      "Next block plan:",
      "Revision request:",
    ]) {
      expect(prompt).toContain(label);
    }
    expect(prompt).toContain(
      'top-level keys are exactly "season", "block", "week", "today", "tomorrow", "nextWeek", "nextBlock", "diet", and "bodyMetrics"',
    );
    expect(prompt).toContain("Create the current block starting on 2026-10-21");
    expect(prompt).toContain(
      '- Revise the current week and return it in "week".',
    );
    expect(prompt).toContain(
      '- Create or revise today\'s session and return it in "today".',
    );
  });

  it("asks for a season refresh in place with the stored block start date", () => {
    const prompt = buildPlanUpdatePrompt(
      updateInput({
        revision: {
          ...updateInput().revision,
          season: true,
          block: true,
          week: true,
          day: true,
        },
        blockStartDate: "2026-10-21",
      }),
    );

    expect(prompt).toContain("The current block must start on 2026-10-21");
  });

  it("includes survey adjustments in a season refresh", () => {
    const prompt = buildPlanUpdatePrompt(
      updateInput({
        revision: {
          ...updateInput().revision,
          season: true,
          block: true,
          week: true,
          day: true,
        },
        coachingSurveyAdjustments: [
          {
            question: "How many hours can you train each week?",
            previousQuestion: "How many hours do you train each week?",
            previousAnswer: "About six.",
            answer: "About nine.",
          },
        ],
      }),
    );

    expect(prompt).toContain(
      "Coaching survey adjustments since the plan was generated",
    );
    expect(prompt).toContain("How many hours can you train each week?");
    expect(prompt).toContain("How many hours do you train each week?");
    expect(prompt).toContain("Previous answer: About six.");
    expect(prompt).toContain("New answer: About nine.");
  });

  it("keeps survey adjustments out of updates that do not refresh the season", () => {
    const prompt = buildPlanUpdatePrompt(
      updateInput({
        coachingSurveyAdjustments: [
          {
            question: "How many hours can you train each week?",
            previousQuestion: null,
            previousAnswer: null,
            answer: "About nine.",
          },
        ],
      }),
    );

    expect(prompt).not.toContain("Coaching survey adjustments");
  });

  it("states the next week and tomorrow dates when they are requested", () => {
    const prompt = buildPlanUpdatePrompt(
      updateInput({
        today: "2026-10-25",
        todayPlan: { ...todayPlan, date: "2026-10-25" },
        revision: {
          ...updateInput().revision,
          tomorrow: true,
          nextWeek: true,
        },
        nextWeekStartDate: "2026-10-26",
      }),
    );

    expect(prompt).toContain(`${weekDatesRule("2026-10-26", "next week")}.`);
    expect(prompt).toContain("Tomorrow is 2026-10-26.");
    expect(prompt).toContain(
      '- Return tomorrow\'s session in "tomorrow" and place its outline in the current week or the next week.',
    );
  });

  it("includes a completed week review, its comment and the coach reply", () => {
    const prompt = buildPlanUpdatePrompt(
      updateInput({
        periodReviews: [
          {
            kind: "week",
            title: "Week starting 2026-10-12",
            startDate: "2026-10-12",
            endDate: "2026-10-18",
            summary: "The week was consistent but the long run was hard.",
            comment: "My legs felt heavy after Thursday.",
            reply: "Keep the next long run easy and shorten the intervals.",
            weeklyNote: {
              note: "I can only ride outdoors on Saturday.",
              reply: "Then we will put the long ride on Saturday.",
            },
            updatedAt: "2026-10-19T08:00:00Z",
          },
        ],
        revision: {
          ...updateInput().revision,
          block: true,
          week: true,
          day: true,
        },
        reviseBlock: true,
        blockStartDate: "2026-10-21",
      }),
    );

    expect(prompt).toContain("Completed week and block reviews");
    expect(prompt).toContain(
      "The week was consistent but the long run was hard.",
    );
    expect(prompt).toContain(
      "Athlete comment: My legs felt heavy after Thursday.",
    );
    expect(prompt).toContain(
      "Coach reply: Keep the next long run easy and shorten the intervals.",
    );
    expect(prompt).toContain(
      "Weekly note for the week starting 2026-10-12 (2026-10-12 → 2026-10-18): I can only ride outdoors on Saturday.",
    );
    expect(prompt).toContain(
      "Coach reply to the weekly note: Then we will put the long ride on Saturday.",
    );
    expect(prompt).toContain("keep its start date (2026-10-21)");
  });
});

describe("daily update prompt", () => {
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
    expect(prompt).toContain(
      "Weekly note for the week starting 2026-10-19 (2026-10-19 → 2026-10-25):\nI cannot train on Thursday this week.",
    );
    expect(prompt).toContain(
      "Coach reply to the weekly note:\nUnderstood; Thursday is a rest day.",
    );
    expect(prompt).toContain(WEEKLY_NOTE_SCOPE_RULE);
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Block: Base");
    expect(prompt).toContain("Week starting 2026-10-19");
    expect(prompt).toContain("Easy run");
    expect(prompt).toContain(
      'top-level keys are exactly "today", "tomorrow", "week", "diet", and "bodyMetrics"',
    );
  });

  it("refreshes diet progress without changing the training", () => {
    const prompt = buildPlanUpdatePrompt(
      updateInput({
        revision: { ...updateInput().revision, progress: true },
      }),
    );

    expect(prompt).toContain('Change only the "dietProgress" objects');
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain('except for "dietProgress"');
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
    expect(prompt).toContain(
      "Fully detail the day objects dated 2026-10-21 through 2026-10-22",
    );
    expect(prompt).toContain(
      "Keep every session in the week, including 2026-10-21 through 2026-10-22, as a short outline.",
    );
  });

  it("details only the target day when planning the next period", () => {
    const prompt = buildDailyUpdatePrompt({
      ...base,
      today: "2026-10-26",
      detailThrough: "2026-10-26",
      season,
      block,
      week: { ...week, startDate: "2026-10-26" },
    });

    expect(prompt).toContain(
      "Fully detail the day objects dated 2026-10-26 through 2026-10-26",
    );
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

describe("weekly update prompt", () => {
  it("asks for the new week as a set of outlines", () => {
    expect(
      buildWeeklyUpdatePrompt({
        ...base,
        season,
        block,
        weekStartDate: "2026-10-26",
      }),
    ).toContain(
      "Create all seven days as short outlines; the following daily update will turn each day into a concrete workout when it arrives.",
    );
  });

  it("includes the week start date and the current block", () => {
    const prompt = buildWeeklyUpdatePrompt({
      ...base,
      season,
      block,
      weekStartDate: "2026-10-26",
    });

    expect(prompt).toContain(
      `Week start date: 2026-10-26. ${weekDatesRangeRule("2026-10-26")}.`,
    );
    expect(prompt).toContain("Goal: Sub-4-hour marathon");
    expect(prompt).toContain("Block: Base");
    expect(prompt).toContain("Aerobic base + strides");
    expect(prompt).toContain(
      'top-level keys are exactly "week", "block", and "bodyMetrics"',
    );
  });
});
