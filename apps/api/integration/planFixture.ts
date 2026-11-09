import {
  addDays,
  coachPlanSchema,
  type CalorieBreakdown,
  type CoachPlan,
  type DayPlan,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";

/** Monday starting the plan's current week. */
export const PLAN_WEEK_START = "2026-11-09";
/** Monday starting the outlined next week. */
export const NEXT_WEEK_START = "2026-11-16";
/** The plan's concrete day after today. */
export const PLAN_TOMORROW_DATE = "2026-11-10";

/** The calories the fixture's detailed today and tomorrow allocate. */
export const TODAY_CALORIES_KCAL = 2600;
export const TOMORROW_CALORIES_KCAL = 2700;
export const NEXT_WEEK_CALORIES_KCAL = 2800;

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export interface FixtureWorkout {
  durationMinutes: number;
  estimatedTss: number;
  caloriesKcal: number;
}

const TODAY_WORKOUT: FixtureWorkout = {
  durationMinutes: 60,
  estimatedTss: 50,
  caloriesKcal: TODAY_CALORIES_KCAL,
};

const TOMORROW_WORKOUT: FixtureWorkout = {
  durationMinutes: 45,
  estimatedTss: 40,
  caloriesKcal: TOMORROW_CALORIES_KCAL,
};

/** A calorie breakdown whose parts add up to the supplied total. */
function breakdownFor(caloriesKcal: number): CalorieBreakdown {
  return {
    basalMetabolismKcal: 1900,
    workoutCaloriesKcal: caloriesKcal - 1700,
    dietDeficitKcal: 200,
  };
}

/**
 * Builds a valid Monday-start week. A null day is a rest day; the schema
 * requires exactly seven sessions.
 */
export function makeWeek(
  startDate: string,
  workouts: readonly (FixtureWorkout | null)[],
): WeekPlan {
  if (workouts.length !== 7) {
    throw new Error("A fixture week needs exactly seven entries");
  }
  const sessions: WeekSession[] = workouts.map((workout, index) => {
    const date = addDays(startDate, index);
    const day = WEEKDAYS[index];
    if (day === undefined) {
      throw new Error(`No weekday for session ${index}`);
    }
    if (workout === null) {
      return {
        date,
        day,
        type: "rest",
        title: "Rest",
        description: "Recovery day with no planned session.",
        durationMinutes: 0,
        intensity: "rest",
        status: "rest",
      };
    }
    return {
      date,
      day,
      type: "workout",
      title: `${day} workout`,
      description: "A moderate session built to the plan's focus.",
      durationMinutes: workout.durationMinutes,
      intensity: "moderate",
      status: "planned",
      estimatedTss: workout.estimatedTss,
      estimatedCaloriesKcal: workout.caloriesKcal,
      calorieBreakdown: breakdownFor(workout.caloriesKcal),
    };
  });

  return {
    startDate,
    focus: "Build aerobic durability",
    sessions,
    rationale: "Steady volume with one longer aerobic session.",
    estimatedFtpWatts: 250,
  };
}

function makeDay(
  date: string,
  workout: FixtureWorkout,
  title: string,
): DayPlan {
  return {
    date,
    type: "workout",
    title,
    description: "A moderate session built to the plan's focus.",
    durationMinutes: workout.durationMinutes,
    intensity: "moderate",
    alternatives: [],
    rationale: "It fits today's available time and the week's load.",
    optional: false,
    status: "planned",
    estimatedTss: workout.estimatedTss,
    estimatedCaloriesKcal: workout.caloriesKcal,
    calorieBreakdown: breakdownFor(workout.caloriesKcal),
  };
}

export interface PlanOverrides {
  /** Title of the detailed today plan, for identifying a replacement. */
  todayTitle?: string;
  /** Workouts for the current week; the next week keeps its outline. */
  weekWorkouts?: readonly (FixtureWorkout | null)[];
}

const DEFAULT_WEEK_WORKOUTS: readonly (FixtureWorkout | null)[] = [
  { durationMinutes: 60, estimatedTss: 50, caloriesKcal: 2500 },
  { durationMinutes: 90, estimatedTss: 70, caloriesKcal: 2600 },
  null,
  null,
  null,
  null,
  null,
];

/**
 * A complete, schema-valid four-level plan. Parsing it means the fixture cannot
 * drift from the shared contract as the plan schema evolves.
 */
export function makePlan(overrides: PlanOverrides = {}): CoachPlan {
  return coachPlanSchema.parse({
    season: {
      goal: "Finish the autumn sportive strongly",
      introduction: "We will build this season together.",
      startDate: "2026-11-02",
      endDate: "2027-02-28",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic durability",
          startDate: "2026-11-02",
          endDate: "2026-11-29",
          weekCount: 4,
        },
      ],
      rationale: "A base block before the build.",
      estimatedFtpWatts: 250,
    },
    block: {
      name: "Base",
      focus: "Aerobic durability",
      startDate: "2026-11-02",
      endDate: "2026-11-29",
      weeks: [
        {
          number: 1,
          startDate: "2026-11-02",
          focus: "Settle into a routine",
          targetLoad: "Moderate",
        },
      ],
      rationale: "Consistent aerobic work with room to recover.",
      estimatedFtpWatts: 250,
    },
    week: makeWeek(
      PLAN_WEEK_START,
      overrides.weekWorkouts ?? DEFAULT_WEEK_WORKOUTS,
    ),
    today: makeDay(
      PLAN_WEEK_START,
      TODAY_WORKOUT,
      overrides.todayTitle ?? "Today's session",
    ),
    tomorrow: makeDay(
      PLAN_TOMORROW_DATE,
      TOMORROW_WORKOUT,
      "Tomorrow's session",
    ),
    nextWeek: makeWeek(NEXT_WEEK_START, [
      {
        durationMinutes: 120,
        estimatedTss: 100,
        caloriesKcal: NEXT_WEEK_CALORIES_KCAL,
      },
      null,
      null,
      null,
      null,
      null,
      null,
    ]),
    nextBlock: null,
    diet: null,
  });
}
