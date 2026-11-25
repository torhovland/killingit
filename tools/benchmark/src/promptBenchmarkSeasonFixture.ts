import {
  addDays,
  type AthleteEvent,
  type BlockPlan,
  type BlockSubGoal,
  type DailyWeather,
  type DayPlan,
  type MetricPoint,
  type SeasonGoal,
  type SeasonPlan,
  type ThresholdSummary,
  type WeekPlan,
  type WeekSession,
  type WeekSessionStatus,
} from "@killingit/shared";
import type { PlanContextInput } from "../../../apps/api/src/llm/planContext.js";
import type { AthleteAnswerContext } from "../../../apps/api/src/llm/profileContext.js";

/**
 * The moment from the full-season goal test that the goal-steering prompt
 * replays: Sunday 2027-07-04, seven weeks before the 100 km gravel race, after
 * a compliant athlete has completed every session in a plan that has quietly
 * under-loaded him. His FTP is about 247 W, the race needs about 281 W in a
 * group, and the stored block is still prescribing 215-280 TSS weeks even
 * though he says every workout feels easy.
 *
 * The plan, the week and the athlete state are taken from the openai/gpt-6-luna
 * compliant season run (`results-full-previous.json`, the run that finished
 * 3:24:14 against the 3:10 target). The fixture is code rather than a frozen
 * prompt so every prompt-rule or contract change still reaches the benchmark.
 * The stored season carries the structured goal ledger and the under-loaded
 * gravel block carries the modest sub-goal target the refresh must revise.
 */

export const GOAL_STEERING_TODAY = "2027-07-04";

export const GOAL_STEERING_WEEK_START = "2027-06-28";

export const GOAL_STEERING_NEXT_WEEK_START = "2027-07-05";

export const GOAL_STEERING_BLOCK_START = "2027-06-21";

const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const PROFILE_TEXT =
  "I am a 50-year-old man, 187 cm and 85 kg, living in Trondheim, Norway. I trained seriously a few years ago but I am out of shape now and have not done any consistent training recently. Five years ago my cycling FTP was about 285 W; right now it is about 180 W. My running threshold pace is about 6:00 per km. I do not know my current 10 km or half-marathon time. My resting heart rate is about 55 bpm and my maximum heart rate is about 185 bpm. Five years ago I rode a 100 km gravel race with 1170 m of climbing in 3:20, with an average heart rate of 163 bpm. This season I want to run a half marathon under 2:00 on 2027-05-23, and ride a 100 km gravel race with 1170 m of climbing on 2027-08-22 in 3:10 or faster. Please plan my season from 2026-11-22 through the week ending 2027-08-29. I can train 8-10 hours a week, mostly early mornings, and I am healthy with no injuries.";

const WEEKLY_FEEDBACK =
  "Every workout this week felt easy. I finished every session with plenty left and felt ready for more.";

const TODAY_PLAN: DayPlan = {
  date: GOAL_STEERING_TODAY,
  type: "workout",
  title: "Easy recovery ride",
  description:
    "Short, relaxed spin to maintain aerobic frequency while recovering from the long ride; about 45 minutes easy.",
  durationMinutes: 45,
  intensity: "easy",
  alternatives: [
    "Skip it if the legs are heavy; the long ride is the week's key session.",
    "Keep it on the trainer if the weather turns.",
  ],
  rationale:
    "A short easy spin clears the legs after yesterday's long ride without adding fatigue before the next build week.",
  optional: true,
  optionalRationale:
    "Skipping it costs little today; the long ride already delivered the week's main stimulus, and the next block starts on Monday.",
  status: "completed",
  outdoor: true,
  canBeOutdoor: true,
  bikeWorkout: null,
  weather: {
    date: "2027-07-04",
    icon: "rain",
    temperatureMinC: 10.8,
    temperatureMaxC: 18.8,
    windMaxMs: 2,
    gustMaxMs: 8,
    precipitationMm: 6,
    sunrise: "02:20",
    sunset: "22:39",
  },
  estimatedTss: 22,
  estimatedCaloriesKcal: 2450,
  calorieBreakdown: {
    basalMetabolismKcal: 2250,
    workoutCaloriesKcal: 200,
    dietDeficitKcal: 0,
  },
  trainingLoad: { tss: 22, atl: 33.5, ctl: 31.5, tsb: -2 },
};

const TOMORROW_PLAN: DayPlan = {
  date: GOAL_STEERING_NEXT_WEEK_START,
  type: "workout",
  title: "Easy aerobic ride",
  description:
    "Comfortable outdoor cycling adds low-stress aerobic volume and starts the week with fresh legs; about 60 minutes easy.",
  durationMinutes: 60,
  intensity: "easy",
  alternatives: [
    "Ride the trainer if the weather is wet and the roads are busy.",
    "Cut it to thirty minutes if the legs are still tired from the long ride.",
  ],
  rationale:
    "The first day of the next build week should add aerobic volume without compromising the quality session later in the week.",
  optional: false,
  optionalRationale:
    "Skipping it would leave the week short of the volume the gravel block is built on, but a shorter easy ride is enough if the legs are heavy.",
  status: "planned",
  outdoor: true,
  canBeOutdoor: true,
  bikeWorkout: null,
  weather: {
    date: "2027-07-05",
    icon: "sun",
    temperatureMinC: 10.9,
    temperatureMaxC: 18.9,
    windMaxMs: 5,
    gustMaxMs: 8,
    precipitationMm: 1.8,
    sunrise: "02:21",
    sunset: "22:38",
  },
  estimatedTss: 30,
  estimatedCaloriesKcal: 2800,
  calorieBreakdown: {
    basalMetabolismKcal: 2400,
    workoutCaloriesKcal: 400,
    dietDeficitKcal: 0,
  },
};

interface WeekSessionTemplate {
  title: string;
  description: string;
  type: "workout" | "rest";
  intensity: "easy" | "moderate" | "hard" | "rest";
  durationMinutes: number;
  outdoor: boolean;
  canBeOutdoor: boolean;
  estimatedTss: number;
}

/** The completed week ending on the prompt day, as the athlete lived it. */
const CURRENT_WEEK_SESSIONS: readonly WeekSessionTemplate[] = [
  {
    title: "Rest",
    description:
      "Recover after the weekend's long ride; full rest keeps the next training days productive.",
    type: "rest",
    intensity: "rest",
    durationMinutes: 0,
    outdoor: false,
    canBeOutdoor: false,
    estimatedTss: 0,
  },
  {
    title: "Easy aerobic ride",
    description:
      "Comfortable aerobic cycling to build repeatable volume after the rest day; about 60 minutes easy.",
    type: "workout",
    intensity: "easy",
    durationMinutes: 60,
    outdoor: true,
    canBeOutdoor: true,
    estimatedTss: 30,
  },
  {
    title: "Rest",
    description:
      "Keep a clear recovery day before the week's sustained-power session.",
    type: "rest",
    intensity: "rest",
    durationMinutes: 0,
    outdoor: false,
    canBeOutdoor: false,
    estimatedTss: 0,
  },
  {
    title: "Controlled sustained-power ride",
    description:
      "Indoor bike session with controlled tempo intervals to build sustained power for gravel climbs; about 75 minutes moderate overall.",
    type: "workout",
    intensity: "moderate",
    durationMinutes: 75,
    outdoor: false,
    canBeOutdoor: false,
    estimatedTss: 55,
  },
  {
    title: "Easy aerobic ride",
    description:
      "Easy spinning adds low-stress aerobic volume and supports recovery from the quality ride; about 45 minutes easy.",
    type: "workout",
    intensity: "easy",
    durationMinutes: 45,
    outdoor: true,
    canBeOutdoor: true,
    estimatedTss: 22,
  },
  {
    title: "Long aerobic ride",
    description:
      "Extend steady time in the saddle for gravel-race durability; about 2 hours 45 minutes easy to moderate.",
    type: "workout",
    intensity: "moderate",
    durationMinutes: 165,
    outdoor: true,
    canBeOutdoor: true,
    estimatedTss: 85,
  },
  {
    title: "Easy recovery ride",
    description:
      "Short, relaxed spin to maintain aerobic frequency while recovering from the long ride; about 45 minutes easy.",
    type: "workout",
    intensity: "easy",
    durationMinutes: 45,
    outdoor: true,
    canBeOutdoor: true,
    estimatedTss: 22,
  },
];

const WEEK_WEATHER: readonly DailyWeather[] = [
  {
    date: "2027-07-04",
    icon: "rain",
    temperatureMinC: 10.8,
    temperatureMaxC: 18.8,
    windMaxMs: 2,
    gustMaxMs: 8,
    precipitationMm: 6,
    sunrise: "02:20",
    sunset: "22:39",
  },
  {
    date: "2027-07-05",
    icon: "sun",
    temperatureMinC: 10.9,
    temperatureMaxC: 18.9,
    windMaxMs: 5,
    gustMaxMs: 8,
    precipitationMm: 1.8,
    sunrise: "02:21",
    sunset: "22:38",
  },
  {
    date: "2027-07-06",
    icon: "rain",
    temperatureMinC: 10.9,
    temperatureMaxC: 18.9,
    windMaxMs: 4,
    gustMaxMs: 5,
    precipitationMm: 4.2,
    sunrise: "02:22",
    sunset: "22:37",
  },
  {
    date: "2027-07-07",
    icon: "sun",
    temperatureMinC: 10.9,
    temperatureMaxC: 18.9,
    windMaxMs: 2,
    gustMaxMs: 5,
    precipitationMm: 0,
    sunrise: "02:23",
    sunset: "22:36",
  },
  {
    date: "2027-07-08",
    icon: "rain",
    temperatureMinC: 10.9,
    temperatureMaxC: 18.9,
    windMaxMs: 6,
    gustMaxMs: 9,
    precipitationMm: 2.4,
    sunrise: "02:24",
    sunset: "22:35",
  },
  {
    date: "2027-07-09",
    icon: "rain",
    temperatureMinC: 10.9,
    temperatureMaxC: 18.9,
    windMaxMs: 5,
    gustMaxMs: 6,
    precipitationMm: 4.8,
    sunrise: "02:26",
    sunset: "22:33",
  },
  {
    date: "2027-07-10",
    icon: "partly_cloudy",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 3,
    gustMaxMs: 6,
    precipitationMm: 0,
    sunrise: "02:27",
    sunset: "22:32",
  },
  {
    date: "2027-07-11",
    icon: "rain",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 2,
    gustMaxMs: 10,
    precipitationMm: 3,
    sunrise: "02:28",
    sunset: "22:31",
  },
  {
    date: "2027-07-12",
    icon: "rain",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 6,
    gustMaxMs: 7,
    precipitationMm: 5.4,
    sunrise: "02:30",
    sunset: "22:29",
  },
  {
    date: "2027-07-13",
    icon: "very_cloudy",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 4,
    gustMaxMs: 7,
    precipitationMm: 0,
    sunrise: "02:31",
    sunset: "22:28",
  },
  {
    date: "2027-07-14",
    icon: "rain",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 3,
    gustMaxMs: 11,
    precipitationMm: 3.6,
    sunrise: "02:33",
    sunset: "22:26",
  },
  {
    date: "2027-07-15",
    icon: "rain",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 2,
    gustMaxMs: 8,
    precipitationMm: 6,
    sunrise: "02:34",
    sunset: "22:25",
  },
  {
    date: "2027-07-16",
    icon: "sun",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 5,
    gustMaxMs: 8,
    precipitationMm: 1.8,
    sunrise: "02:36",
    sunset: "22:23",
  },
  {
    date: "2027-07-17",
    icon: "rain",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 4,
    gustMaxMs: 5,
    precipitationMm: 4.2,
    sunrise: "02:38",
    sunset: "22:21",
  },
  {
    date: "2027-07-18",
    icon: "sun",
    temperatureMinC: 11,
    temperatureMaxC: 19,
    windMaxMs: 2,
    gustMaxMs: 5,
    precipitationMm: 0,
    sunrise: "02:39",
    sunset: "22:20",
  },
];

const GOAL_STEERING_ANSWERS: readonly AthleteAnswerContext[] = [
  {
    prompt: "Tell me about yourself, your training history and your goals.",
    answer: PROFILE_TEXT,
    skipped: false,
    answeredAt: "2026-11-22",
  },
];

const GOAL_STEERING_EVENTS: readonly AthleteEvent[] = [
  {
    startDate: "2027-05-23",
    endDate: null,
    title: "Half marathon, sub-2:00 goal",
    kind: "race",
  },
  {
    startDate: "2027-08-22",
    endDate: null,
    title: "100 km gravel race, 1170 m climbing, 3:10 goal",
    kind: "race",
  },
];

const GOAL_STEERING_ACTIVITIES: PlanContextInput["recentActivities"] = [
  {
    summary: {
      id: 601,
      name: "Easy recovery ride",
      type: "cycling",
      startDate: "2027-07-04T10:00:00Z",
      distance: 15_233,
      movingTime: 2_700,
      elapsedTime: 2_760,
      totalElevationGain: 175,
      averagePower: 120,
      normalizedPower: 134,
      averageHeartRate: 144,
      averageSpeed: 5.64,
      maxSpeed: 7.9,
    },
    analysis:
      "A relaxed recovery spin after the long ride. Normalized power of 134 W stayed in the easy aerobic range, heart rate averaged 144 bpm, and the legs looked fresh throughout.",
  },
  {
    summary: {
      id: 602,
      name: "Long aerobic ride",
      type: "cycling",
      startDate: "2027-07-03T09:00:00Z",
      distance: 56_610,
      movingTime: 9_900,
      elapsedTime: 10_200,
      totalElevationGain: 720,
      averagePower: 120,
      normalizedPower: 137,
      averageHeartRate: 144,
      averageSpeed: 5.72,
      maxSpeed: 9.5,
    },
    analysis:
      "The week's endurance anchor: 2 hours 45 minutes at 137 W normalized and 144 bpm average. The effort stayed steady and the athlete finished with plenty left, so the duration was absorbed comfortably.",
  },
  {
    summary: {
      id: 603,
      name: "Easy aerobic ride",
      type: "cycling",
      startDate: "2027-07-02T18:00:00Z",
      distance: 15_163,
      movingTime: 2_700,
      elapsedTime: 2_760,
      totalElevationGain: 160,
      averagePower: 119,
      normalizedPower: 133,
      averageHeartRate: 144,
      averageSpeed: 5.62,
      maxSpeed: 7.8,
    },
    analysis:
      "A short easy ride at 133 W normalized. It added aerobic frequency without meaningful fatigue before the weekend.",
  },
  {
    summary: {
      id: 604,
      name: "Controlled sustained-power ride",
      type: "cycling",
      startDate: "2027-07-01T17:30:00Z",
      distance: 0,
      movingTime: 4_500,
      elapsedTime: 4_560,
      totalElevationGain: 0,
      averagePower: 150,
      normalizedPower: 162,
      averageHeartRate: 149,
      averageSpeed: 0,
      maxSpeed: 0,
    },
    analysis:
      "A 75-minute indoor session at 162 W normalized, about 66 % of FTP. The tempo blocks were controlled and repeatable, but the session stayed well below the sustained power a 3:10 gravel race needs.",
  },
  {
    summary: {
      id: 605,
      name: "Easy aerobic ride",
      type: "cycling",
      startDate: "2027-06-29T10:00:00Z",
      distance: 20_402,
      movingTime: 3_600,
      elapsedTime: 3_780,
      totalElevationGain: 239,
      averagePower: 128,
      normalizedPower: 135,
      averageHeartRate: 144,
      averageSpeed: 5.67,
      maxSpeed: 8.2,
    },
    analysis:
      "An easy hour at 135 W normalized. The aerobic work was comfortable and the climbs were spun rather than pushed.",
  },
  {
    summary: {
      id: 606,
      name: "Long aerobic ride",
      type: "cycling",
      startDate: "2027-06-27T09:00:00Z",
      distance: 51_464,
      movingTime: 9_000,
      elapsedTime: 9_180,
      totalElevationGain: 610,
      averagePower: 126,
      normalizedPower: 137,
      averageHeartRate: 144,
      averageSpeed: 5.72,
      maxSpeed: 9.4,
    },
    analysis:
      "A 2 hour 30 minute endurance ride at 137 W normalized. The athlete completed it comfortably and reported no back or saddle trouble.",
  },
  {
    summary: {
      id: 607,
      name: "Easy maintenance run",
      type: "running",
      startDate: "2027-06-25T06:40:00Z",
      distance: 3_894,
      movingTime: 2_100,
      elapsedTime: 2_160,
      totalElevationGain: 35,
      averageHeartRate: 147,
      averageSpeed: 1.854,
      maxSpeed: 2.1,
    },
    analysis:
      "A short easy run at about 6:40 per kilometre. Heart rate stayed controlled and the run served as impact tolerance rather than a hard session.",
  },
  {
    summary: {
      id: 608,
      name: "Easy aerobic ride",
      type: "cycling",
      startDate: "2027-06-24T18:00:00Z",
      distance: 20_402,
      movingTime: 3_600,
      elapsedTime: 3_780,
      totalElevationGain: 239,
      averagePower: 125,
      normalizedPower: 134,
      averageHeartRate: 144,
      averageSpeed: 5.67,
      maxSpeed: 8.2,
    },
    analysis:
      "An easy hour at 134 W normalized. It built repeatable volume without adding a meaningful training stimulus.",
  },
];

const GOAL_STEERING_THRESHOLDS: readonly ThresholdSummary[] = [
  {
    date: "2027-07-04",
    sport: "cycling",
    measure: "ftp",
    label: "FTP",
    unit: "W",
    kind: "power",
    value: 247,
    source: "garmin",
  },
  {
    date: "2027-07-04",
    sport: "cycling",
    measure: "threshold_heart_rate",
    label: "Threshold heart rate",
    unit: "bpm",
    kind: "heart_rate",
    value: 168,
    source: "garmin",
  },
  {
    date: "2027-07-04",
    sport: "running",
    measure: "threshold_pace",
    label: "Threshold pace",
    unit: "s/km",
    kind: "pace",
    value: 331,
    source: "garmin",
  },
  {
    date: "2027-07-04",
    sport: "running",
    measure: "threshold_heart_rate",
    label: "Threshold heart rate",
    unit: "bpm",
    kind: "heart_rate",
    value: 168,
    source: "garmin",
  },
];

const GOAL_STEERING_FTP_HISTORY: readonly Pick<
  MetricPoint,
  "date" | "value" | "source"
>[] = [
  { date: "2027-06-14", value: 249, source: "coach" },
  { date: "2027-06-21", value: 248, source: "coach" },
  { date: "2027-06-28", value: 248, source: "coach" },
  { date: "2027-07-04", value: 247, source: "garmin" },
];

function weekStatus(template: WeekSessionTemplate): WeekSessionStatus {
  return template.type === "rest" ? "rest" : "completed";
}

function weekSessions(): WeekSession[] {
  return CURRENT_WEEK_SESSIONS.map((template, index) => ({
    date: addDays(GOAL_STEERING_WEEK_START, index),
    day: WEEK_DAYS[index] ?? "Monday",
    type: template.type,
    title: template.title,
    description: template.description,
    durationMinutes: template.durationMinutes,
    intensity: template.intensity,
    status: weekStatus(template),
    outdoor: template.outdoor,
    canBeOutdoor: template.canBeOutdoor,
    bikeWorkout: null,
    estimatedTss: template.estimatedTss,
    estimatedCaloriesKcal: template.type === "rest" ? 2250 : 2450,
    calorieBreakdown: {
      basalMetabolismKcal: 2250,
      workoutCaloriesKcal: template.type === "rest" ? 0 : 200,
      dietDeficitKcal: 0,
    },
    estimatedFtpWatts: 247,
    weather:
      WEEK_WEATHER.find(
        (day) => day.date === addDays(GOAL_STEERING_WEEK_START, index),
      ) ?? null,
  }));
}

const GOAL_STEERING_GOALS: readonly SeasonGoal[] = [
  {
    title: "Sub-2:00 half marathon",
    date: "2027-05-23",
    priority: "A",
    target: "Under 2:00",
  },
  {
    title: "100 km gravel race",
    date: "2027-08-22",
    priority: "A",
    target: "3:10 or faster",
  },
];

function subGoal(
  goal: SeasonGoal,
  role: BlockSubGoal["role"],
  target: string,
  byDate: string,
): BlockSubGoal {
  return {
    goalTitle: goal.title,
    goalDate: goal.date,
    role,
    target,
    byDate,
  };
}

const HALF = GOAL_STEERING_GOALS[0] as SeasonGoal;
const GRAVEL = GOAL_STEERING_GOALS[1] as SeasonGoal;

/** The season the athlete is part way through in the goal test. */
export function goalSteeringSeasonPlan(): SeasonPlan {
  return {
    goal: "Run a half marathon under 2:00 on 2027-05-23, then ride the 100 km gravel race with 1170 m of climbing in 3:10 or faster.",
    introduction:
      "Welcome! I’m your coach for the season, and I’m looking forward to helping you build back into consistent training and take on both goals. We’ll start steadily, then make the work specific when you’re ready for it.",
    startDate: "2026-11-22",
    endDate: "2027-08-29",
    estimatedFtpWatts: 250,
    rationale:
      "Two goals anchor the season: a sub-2:00 half marathon in May, then a 100 km gravel race in 3:10 in August. The season builds an aerobic base through the Norwegian winter, develops running durability into the half marathon, recovers, then converts cycling fitness into gravel-specific long-ride durability and sustained climbing power. The gravel target is ambitious for a 180 W starting point; the long ride and sustained-power work are the two levers that matter.",
    goals: [...GOAL_STEERING_GOALS],
    blocks: [
      {
        name: "Return to training",
        focus: "Establish a consistent, easy routine",
        startDate: "2026-11-22",
        endDate: "2026-12-19",
        weekCount: 4,
        subGoals: [
          subGoal(
            HALF,
            "build",
            "Four easy aerobic sessions a week and a weekly long run-walk",
            "2026-12-19",
          ),
          subGoal(
            GRAVEL,
            "maintain",
            "Two easy rides a week and a baseline FTP near 190 W",
            "2026-12-19",
          ),
        ],
        dietProgress: null,
      },
      {
        name: "Aerobic foundation",
        focus: "Build low-intensity endurance and general durability",
        startDate: "2026-12-20",
        endDate: "2027-02-13",
        weekCount: 8,
        subGoals: [
          subGoal(
            HALF,
            "build",
            "One controlled threshold run a week and a 90-minute long run",
            "2027-02-13",
          ),
          subGoal(
            GRAVEL,
            "maintain",
            "Two rides a week including one two-hour ride, FTP near 220 W",
            "2027-02-13",
          ),
        ],
        dietProgress: null,
      },
      {
        name: "Half-marathon development",
        focus:
          "Build running durability and controlled threshold fitness while maintaining cycling endurance",
        startDate: "2027-02-14",
        endDate: "2027-04-10",
        weekCount: 8,
        subGoals: [
          subGoal(
            HALF,
            "build",
            "10 km tempo at 5:30/km and a 16 km long run",
            "2027-04-10",
          ),
          subGoal(
            GRAVEL,
            "maintain",
            "FTP at least 250 W and one ride of 2.5 hours",
            "2027-04-10",
          ),
        ],
        dietProgress: null,
      },
      {
        name: "Half-marathon specific",
        focus:
          "Develop race-specific endurance and pace control, then taper for the 2027-05-23 half marathon",
        startDate: "2027-04-11",
        endDate: "2027-05-23",
        weekCount: 6,
        subGoals: [
          subGoal(
            HALF,
            "build",
            "Race-pace long run, then taper to run under 2:00",
            "2027-05-23",
          ),
          subGoal(
            GRAVEL,
            "maintain",
            "FTP at least 255 W and two rides a week through the taper",
            "2027-05-23",
          ),
        ],
        dietProgress: null,
      },
      {
        name: "Recovery and cycling base",
        focus: "Recover from the half marathon and rebuild cycling volume",
        startDate: "2027-05-24",
        endDate: "2027-06-20",
        weekCount: 4,
        subGoals: [
          subGoal(
            GRAVEL,
            "build",
            "Recover, then three rides a week and a 2.5-hour long ride",
            "2027-06-20",
          ),
        ],
        dietProgress: null,
      },
      {
        name: "Gravel build",
        focus:
          "Develop long-ride durability, climbing strength and sustained power",
        startDate: "2027-06-21",
        endDate: "2027-08-07",
        weekCount: 7,
        subGoals: [
          subGoal(
            GRAVEL,
            "build",
            "Extend the long ride to 3 hours and lift FTP to 252 W",
            "2027-08-07",
          ),
        ],
        dietProgress: null,
      },
      {
        name: "Gravel taper and race",
        focus:
          "Reduce fatigue, stay sharp, and race the 100 km gravel event on 2027-08-22",
        startDate: "2027-08-08",
        endDate: "2027-08-22",
        weekCount: 2,
        subGoals: [
          subGoal(
            GRAVEL,
            "build",
            "Sharpen, then race the 100 km gravel event",
            "2027-08-22",
          ),
        ],
        dietProgress: null,
      },
      {
        name: "Post-race recovery",
        focus: "Recover after the gravel race",
        startDate: "2027-08-23",
        endDate: "2027-08-29",
        weekCount: 1,
        subGoals: [],
        dietProgress: null,
      },
    ],
    dietProgress: null,
  };
}

/** The under-loaded gravel block the coach must now steer. */
export function goalSteeringBlockPlan(): BlockPlan {
  return {
    name: "Gravel build",
    focus:
      "Develop long-ride durability, climbing strength and sustained power",
    startDate: GOAL_STEERING_BLOCK_START,
    endDate: "2027-08-07",
    estimatedFtpWatts: 248,
    rationale:
      "Seven weeks that turn cycling volume into gravel speed: a long ride grows every week except a mid-block consolidation, one controlled sustained-power or climbing session each week, and the rest easy. The final week starts the taper. The 3:10 target needs the long ride to reach three hours and the quality work to raise FTP, so the block is judged against that gap.",
    subGoals: [
      subGoal(
        GRAVEL,
        "build",
        "Extend the long ride to 3 hours and lift FTP to 252 W",
        "2027-08-07",
      ),
    ],
    weeks: [
      {
        number: 1,
        startDate: "2027-06-21",
        focus:
          "Begin the gravel build with consistent riding, controlled climbing work and a longer endurance ride",
        targetLoad: "about 4.5 hours; about 215 TSS",
        estimatedFtpWatts: 248,
        dietProgress: null,
      },
      {
        number: 2,
        startDate: "2027-06-28",
        focus:
          "Absorb the long ride, then build cycling consistency with controlled sustained power and a longer aerobic ride",
        targetLoad: "about 4 hours; about 215 TSS",
        estimatedFtpWatts: 248,
        dietProgress: null,
      },
      {
        number: 3,
        startDate: "2027-07-05",
        focus:
          "Build climbing strength and steady gravel-race endurance with one quality ride and a longer aerobic anchor",
        targetLoad: "about 5 hours; about 280 TSS",
        estimatedFtpWatts: 249,
        dietProgress: null,
      },
      {
        number: 4,
        startDate: "2027-07-12",
        focus:
          "Consolidate the recent volume while keeping one sustained-power stimulus and a steady long ride",
        targetLoad: "about 4.5 hours; about 230 TSS",
        estimatedFtpWatts: 250,
        dietProgress: null,
      },
      {
        number: 5,
        startDate: "2027-07-19",
        focus:
          "Build sustained climbing power and long-ride durability with one controlled quality session",
        targetLoad: "about 4.5 hours; about 240 TSS",
        estimatedFtpWatts: 250,
        dietProgress: null,
      },
      {
        number: 6,
        startDate: "2027-07-26",
        focus:
          "Maintain gravel-specific endurance with one controlled quality ride and a substantial aerobic ride",
        targetLoad: "about 5 hours; about 250 TSS",
        estimatedFtpWatts: 251,
        dietProgress: null,
      },
      {
        number: 7,
        startDate: "2027-08-02",
        focus:
          "Complete the final gravel-specific build stimulus, then begin tapering",
        targetLoad: "about 5.5 hours; about 265 TSS",
        estimatedFtpWatts: 252,
        dietProgress: null,
      },
    ],
    dietProgress: null,
  };
}

/** The completed current week ending on the prompt day. */
export function goalSteeringWeekPlan(): WeekPlan {
  return {
    startDate: GOAL_STEERING_WEEK_START,
    focus:
      "Absorb the long ride, then build cycling consistency with controlled sustained power and a longer aerobic ride",
    rationale:
      "A recovery day after the 150-minute ride lets you absorb this week's endurance stimulus. The week then progresses with one controlled quality ride and a longer aerobic ride, supported by easy cycling and a rest day; this develops gravel-specific durability without turning every ride into a test. The wet forecast on several dates makes an indoor quality session sensible.",
    estimatedFtpWatts: 248,
    sessions: weekSessions(),
    dietProgress: null,
  };
}

/** The detailed day the app stores for the prompt day. */
export function goalSteeringTodayPlan(): DayPlan {
  return TODAY_PLAN;
}

/** The session the athlete will see the next day. */
export function goalSteeringTomorrowPlan(): DayPlan {
  return TOMORROW_PLAN;
}

/** The complete athlete context the season test sent on 2027-07-04. */
export function goalSteeringPlanContext(): PlanContextInput {
  return {
    today: GOAL_STEERING_TODAY,
    timezone: "Europe/Oslo",
    athleteAnswers: GOAL_STEERING_ANSWERS,
    recentActivities: GOAL_STEERING_ACTIVITIES,
    manualActivities: [],
    activityComments: [],
    weeklyNote: WEEKLY_FEEDBACK,
    weeklyNoteWeekStartDate: GOAL_STEERING_WEEK_START,
    weeklyNoteReply: null,
    periodReviews: [
      {
        kind: "week",
        title: "Gravel build, week 1",
        startDate: "2027-06-21",
        endDate: "2027-06-27",
        summary:
          "The athlete completed all six prescribed workouts and both rest days, about 215 TSS. The controlled climbing intervals and the 150-minute long ride were the key sessions, and every session matched its prescription.",
        comment: null,
        reply: null,
        weeklyNote: {
          note: WEEKLY_FEEDBACK,
          reply: null,
        },
        updatedAt: "2027-06-27T21:00:00Z",
      },
    ],
    forecast: WEEK_WEATHER,
    locationName: "Trondheim, Norway",
    athleteFtpWatts: 247,
    ftpHistory: GOAL_STEERING_FTP_HISTORY,
    thresholds: GOAL_STEERING_THRESHOLDS,
    bodyHistory: {
      weight: [{ date: "2026-11-22", value: 85, source: "user" }],
      bodyFat: [],
    },
    events: GOAL_STEERING_EVENTS,
    dietGoal: null,
    dietAdvice: false,
    calorieHistory: undefined,
    dailyHealth: undefined,
    currentForm: { tss: 22, atl: 33.5, ctl: 31.5, tsb: -2 },
  };
}
