import { describe, expect, it } from "bun:test";
import type {
  BlockPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { BODY_METRIC_RULES, WEEK_OUTLINE_RULES } from "./planContext.js";
import {
  buildDailyUpdatePrompt,
  buildPlanUpdatePrompt,
  buildWeeklyUpdatePrompt,
  DAILY_UPDATE_SYSTEM_PROMPT,
  PLAN_UPDATE_SYSTEM_PROMPT,
  RATIONALE_RULES,
  WEATHER_PLANNING_RULES,
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
    },
    ...overrides,
  };
}

describe("unified plan update prompt", () => {
  it("receives every level and asks for every level in one response", () => {
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

    expect(prompt).toContain("Current season plan:");
    expect(prompt).toContain("Current block plan:");
    expect(prompt).toContain("Current week plan:");
    expect(prompt).toContain("Today's plan:");
    expect(prompt).toContain("Tomorrow's plan:");
    expect(prompt).toContain("Next week plan:");
    expect(prompt).toContain("Next block plan:");
    expect(prompt).toContain("Revision request:");
    expect(prompt).toContain(
      'top-level keys are exactly "season", "block", "week", "today", "tomorrow", "nextWeek", "nextBlock", and "bodyMetrics"',
    );
    expect(prompt).toContain("Create the current block starting on 2026-10-21");
    expect(prompt).toContain("Revise the current week");
    expect(prompt).toContain("Create or revise today's session");
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

    expect(prompt).toContain(
      "Refresh the season and the current block in place",
    );
    expect(prompt).toContain(
      "keep the blocks that ended before today unchanged",
    );
    expect(prompt).toContain("must start on 2026-10-21");
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

    expect(prompt).toContain(
      "The next week must start on 2026-10-26 and contain exactly seven sessions dated 2026-10-26, 2026-10-27, 2026-10-28, 2026-10-29, 2026-10-30, 2026-10-31, 2026-11-01.",
    );
    expect(prompt).toContain("Tomorrow is 2026-10-26.");
    expect(prompt).toContain(
      'Return tomorrow\'s session in "tomorrow" and place it in the current week or the next week.',
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
    expect(prompt).toContain("Revise the current block in place");
  });

  it("keeps the shared coaching, weather, load and outline rules", () => {
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(
      "state of the art training science",
    );
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(WEEK_OUTLINE_RULES);
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(WEATHER_PLANNING_RULES);
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(BODY_METRIC_RULES);
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain('"bikeWorkout"');
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain('"estimatedTss"');
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain('"estimatedFtpWatts"');
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain('"bodyMetrics"');
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(
      "what the athlete loses toward that goal",
    );
  });

  it("asks for rationales about the revised plan, not the revision", () => {
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(RATIONALE_RULES);
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(
      "explains the plan as it stands after the revision, not the act of revising it",
    );
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(
      "Do not describe the previous plan, what changed, or why the plan was revised.",
    );
    expect(PLAN_UPDATE_SYSTEM_PROMPT).toContain(
      'Do not write phrases such as "we adjusted", "we changed", "this replaces", or "because of the new review".',
    );
  });
});

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
    expect(prompt).toContain("estimate how it will change day by day");
    expect(prompt).toContain('Set "estimatedFtpWatts" on every week session');
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

  it("keeps days after tomorrow as outlines", () => {
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain(WEEK_OUTLINE_RULES);
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain(
      "Treat the week as an outline, not seven finished workouts",
    );
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain(
      "Keep every other future day as a short outline",
    );
    expect(DAILY_UPDATE_SYSTEM_PROMPT).toContain(
      "Fully detail only the sessions",
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
    expect(prompt).toContain(
      "Weekly note for the week starting 2026-10-19 (2026-10-19 → 2026-10-25):\nI cannot train on Thursday this week.",
    );
    expect(prompt).toContain(
      "Coach reply to the weekly note:\nUnderstood; Thursday is a rest day.",
    );
    expect(prompt).toContain(
      "A weekly note is normally scoped to the week it was written for.",
    );
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
    expect(prompt).toContain(
      "Fully detail the sessions dated 2026-10-21 through 2026-10-22",
    );
    expect(prompt).toContain(
      "Keep every later session in the week as a short outline.",
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
      "Fully detail the sessions dated 2026-10-26 through 2026-10-26",
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
    expect(prompt).toContain("estimate how it will change day by day");
    expect(prompt).toContain('Set "estimatedFtpWatts" on every week session');
    expect(prompt).toContain('"bodyMetrics"');
    expect(prompt).toContain(BODY_METRIC_RULES);
    expect(prompt).toContain("training stress score");
  });

  it("requires a week outline and leaves the detail to the daily update", () => {
    expect(WEEKLY_UPDATE_SYSTEM_PROMPT).toContain(WEEK_OUTLINE_RULES);
    expect(WEEKLY_UPDATE_SYSTEM_PROMPT).toContain(
      "Treat the week as an outline, not seven finished workouts",
    );
    expect(WEEKLY_UPDATE_SYSTEM_PROMPT).toContain(
      "the daily update will turn an outline into a concrete workout",
    );
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
