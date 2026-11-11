import {
  addDays,
  coachPlanSchema,
  type Activity,
  type ActivitySummary,
  type AnalyzedActivity,
  type BlockPlan,
  type CoachPlan,
  type DayPlan,
  type SeasonPlan,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";

/** Monday starting the fixture plan's current week. */
export const PLAN_WEEK_START = "2026-10-19";
/** The fixture plan's concrete day. */
export const PLAN_TODAY = "2026-10-21";
/** First day of the fixture plan's current block. */
export const PLAN_BLOCK_START = "2026-10-21";
/** Last day of the fixture plan's current block. */
export const PLAN_BLOCK_END = "2026-12-01";
/** Last day of the fixture plan's season. */
export const PLAN_SEASON_END = "2027-04-01";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function weekday(index: number): string {
  const day = WEEKDAYS[index];
  if (day === undefined) {
    throw new Error(`No weekday for session ${index}`);
  }
  return day;
}

/** A complete season summary, valid as part of a parsed plan. */
export function makeSeason(overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    goal: "Run a marathon.",
    introduction:
      "Hello, I'm your coach. I'm looking forward to working with you.",
    startDate: PLAN_BLOCK_START,
    endDate: PLAN_SEASON_END,
    rationale: "Build a base.",
    blocks: [
      {
        name: "Base",
        focus: "Aerobic",
        startDate: PLAN_BLOCK_START,
        endDate: PLAN_BLOCK_END,
        weekCount: 6,
      },
    ],
    ...overrides,
  };
}

/** The active block, with one outlined week unless overridden. */
export function makeBlock(overrides: Partial<BlockPlan> = {}): BlockPlan {
  const startDate = overrides.startDate ?? PLAN_BLOCK_START;
  return {
    name: "Base",
    focus: "Aerobic",
    rationale: "Establish consistent volume.",
    startDate,
    endDate: PLAN_BLOCK_END,
    weeks: [
      {
        number: 1,
        startDate,
        focus: "Aerobic",
        targetLoad: "Easy",
      },
    ],
    ...overrides,
  };
}

/** A seven-day week of easy sessions. */
export function makeWeek(
  startDate: string = PLAN_WEEK_START,
  overrides: Partial<WeekPlan> = {},
): WeekPlan {
  const sessions: WeekSession[] = Array.from({ length: 7 }, (_, index) => ({
    date: addDays(startDate, index),
    day: weekday(index),
    type: "workout",
    title: `Session ${index + 1}`,
    description: "Easy aerobic work.",
    durationMinutes: 45,
    intensity: "easy",
    status: "planned",
  }));

  return {
    startDate,
    focus: "Aerobic base",
    rationale: "Keep the week easy.",
    sessions,
    ...overrides,
  };
}

/** A concrete day, defaulting to today's easy run. */
export function makeDay(
  date: string = PLAN_TODAY,
  overrides: Partial<DayPlan> = {},
): DayPlan {
  return {
    date,
    type: "workout",
    title: "Easy run",
    description: "45 minutes easy.",
    durationMinutes: 45,
    intensity: "easy",
    alternatives: [],
    rationale: "Easy aerobic work.",
    optional: false,
    status: "planned",
    ...overrides,
  };
}

/**
 * A complete, schema-valid four-level plan. Parsing it means the fixture cannot
 * drift from the shared contract as the plan schema evolves.
 */
export function makePlan(overrides: Partial<CoachPlan> = {}): CoachPlan {
  return coachPlanSchema.parse({
    season: makeSeason(),
    block: makeBlock(),
    week: makeWeek(),
    today: makeDay(),
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    ...overrides,
  });
}

/** A summary of a recorded activity, without its timeseries or coach data. */
export function makeActivitySummary(
  overrides: Partial<ActivitySummary> = {},
): ActivitySummary {
  return {
    id: 1,
    name: "Morning ride",
    type: "cycling",
    startDate: "2026-10-20T07:10:00Z",
    distance: 42000,
    movingTime: 5400,
    elapsedTime: 6000,
    totalElevationGain: 320,
    ...overrides,
  };
}

/** A recorded activity with its timeseries. */
export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    ...makeActivitySummary(),
    samples: [],
    ...overrides,
  };
}

/** A recorded activity with the coach fields an analysed feed carries. */
export function makeAnalyzedActivity(
  overrides: Partial<AnalyzedActivity> = {},
): AnalyzedActivity {
  return {
    ...makeActivitySummary(),
    sampleCount: 0,
    samples: [],
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}
