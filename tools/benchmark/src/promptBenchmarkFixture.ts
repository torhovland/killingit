import {
  type BikeWorkout,
  type BlockPlan,
  type DailyHealthPoint,
  type DailyWeather,
  type DayPlan,
  type DietPlan,
  type MetricPoint,
  type SeasonPlan,
  type ThresholdSummary,
  type TrainingLoad,
  type WeekPlan,
  type WeekSession,
  type WeekSessionStatus,
} from "@killingit/shared";
import type { ActivityCommentContext } from "../../../apps/api/src/llm/activityContext.js";
import type { CalorieTargetPoint } from "../../../apps/api/src/llm/dietContext.js";
import type { PlanContextInput } from "../../../apps/api/src/llm/planContext.js";
import type {
  AthleteAnswerContext,
  CoachingSurveyAdjustmentContext,
} from "../../../apps/api/src/llm/profileContext.js";

/**
 * The athlete the two-prompt benchmark sends to every model. It is a stable
 * fixture, not a database snapshot: the benchmark prompts are built from the
 * real prompt builders, so the fixture only supplies the plan and the athlete
 * context those builders format. Keeping it in code means a prompt change is
 * the only way the benchmark input changes.
 *
 * The scenario is a 47-year-old Trondheim rider preparing for the 2027 brevet
 * series and Paris-Brest-Paris, with a small fat-loss goal, a strength habit,
 * a limited weekday window and a history of burning out after four disciplined
 * months. The season starts on Monday 2026-10-19; the current week is
 * 2026-10-26 to 2026-11-01, which both benchmark dates fall inside.
 */

/** The survey change the season revision has to absorb: the Atlas race. */
export const BENCHMARK_COACHING_SURVEY_ADJUSTMENTS: readonly CoachingSurveyAdjustmentContext[] =
  [
    {
      question: "What is your main goal?",
      previousQuestion: "What is your main goal?",
      previousAnswer:
        "A 200 km brevet in early April 2027, then the full brevet series toward Paris-Brest-Paris in August 2027.",
      answer:
        "I have signed up for the Atlas Mountain Race on 28 February 2027. Paris-Brest-Paris in August 2027 is still the big goal, and I need the brevet series in between, starting with a 200 km in April. I still burn out after about four months of disciplined training, so do not make the whole winter one long grind.",
    },
  ];

const WEEK_START = "2026-10-26";
const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const TRAINER_BIKE_WORKOUT: BikeWorkout = {
  ftpWatts: 225,
  intervals: [
    { durationSeconds: 600, powerPercent: 55 },
    { durationSeconds: 900, powerPercent: 88 },
    { durationSeconds: 300, powerPercent: 55 },
    { durationSeconds: 900, powerPercent: 88 },
    { durationSeconds: 300, powerPercent: 55 },
    { durationSeconds: 900, powerPercent: 88 },
    { durationSeconds: 600, powerPercent: 50 },
  ],
};

interface WeekSessionTemplate {
  title: string;
  plannedDescription: string;
  /** What the athlete recorded, for a day that is already in the past. */
  completedDescription: string;
  type: "workout" | "rest";
  intensity: "easy" | "moderate" | "hard" | "rest";
  durationMinutes: number;
  outdoor: boolean;
  canBeOutdoor: boolean;
  estimatedTss: number;
  missed?: boolean;
  bikeWorkout?: BikeWorkout;
}

const WEEK_SESSIONS: readonly WeekSessionTemplate[] = [
  {
    title: "Full Rest and Recovery",
    plannedDescription:
      "Rest day after the weekend load. Keep the daily eight-minute hip and spine mobility routine and nothing else.",
    completedDescription: "Rest day, mobility routine completed.",
    type: "rest",
    intensity: "rest",
    durationMinutes: 0,
    outdoor: false,
    canBeOutdoor: false,
    estimatedTss: 0,
  },
  {
    title: "Gym Strength A",
    plannedDescription:
      "Three working sets of goblet squats, a light trap-bar pull from knee height and two sets of split squats, keeping two reps in reserve. Log the loads so the next session can progress.",
    completedDescription: "Strength training · 42 min, goblet squats at 16 kg.",
    type: "workout",
    intensity: "moderate",
    durationMinutes: 42,
    outdoor: false,
    canBeOutdoor: false,
    estimatedTss: 30,
  },
  {
    title: "Row and Easy Run",
    plannedDescription:
      "Fifteen minutes of relaxed indoor rowing at 115-130 bpm, then thirty-two easy minutes on the flat paths at a conversational effort.",
    completedDescription:
      "Indoor rowing · 15 min, then an easy run · 8.1 km · 32 min.",
    type: "workout",
    intensity: "easy",
    durationMinutes: 47,
    outdoor: false,
    canBeOutdoor: true,
    estimatedTss: 38,
  },
  {
    title: "Easy Trainer Ride",
    plannedDescription:
      "Sixty easy minutes on the trainer at 110-135 W, spinning above 85 rpm and staying well below the aerobic ceiling.",
    completedDescription: "No activity recorded.",
    type: "workout",
    intensity: "easy",
    durationMinutes: 60,
    outdoor: false,
    canBeOutdoor: false,
    estimatedTss: 35,
    missed: true,
  },
  {
    title: "Trainer Sweet Spot",
    plannedDescription:
      "Three twelve-minute sweet-spot blocks on the trainer with five easy minutes between them, plus a warm-up and cool-down. Hold 88 % of FTP and keep cadence above 85 rpm.",
    completedDescription:
      "Indoor cycling · 40.0 km · 70 min, NP 228 W, cadence 89 rpm.",
    type: "workout",
    intensity: "moderate",
    durationMinutes: 70,
    outdoor: false,
    canBeOutdoor: false,
    estimatedTss: 65,
    bikeWorkout: TRAINER_BIKE_WORKOUT,
  },
  {
    title: "Controlled Mountain Hike",
    plannedDescription:
      "Two-hour hike in Bymarka, keeping the heart rate under 140 bpm so the day stays aerobic and the ankles adapt to the terrain.",
    completedDescription: "Hiking · 11.0 km · 133 min · 320 m climb.",
    type: "workout",
    intensity: "easy",
    durationMinutes: 120,
    outdoor: true,
    canBeOutdoor: true,
    estimatedTss: 60,
  },
  {
    title: "Short Easy Run",
    plannedDescription:
      "Thirty easy minutes on the flat paths at 115-135 bpm. Keep the effort conversational and let the pace fall away on any rise.",
    completedDescription: "Easy run · 5.6 km · 30 min.",
    type: "workout",
    intensity: "easy",
    durationMinutes: 30,
    outdoor: true,
    canBeOutdoor: true,
    estimatedTss: 25,
  },
];

const BENCHMARK_ANSWERS: readonly AthleteAnswerContext[] = [
  {
    prompt: "What is your main goal?",
    answer:
      "A 200 km brevet in early April 2027, then the full brevet series toward Paris-Brest-Paris in August 2027.",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "How old are you?",
    answer: "47",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "Where do you live?",
    answer: "Trondheim, Norway.",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "What is your training history and current performance?",
    answer:
      "About 3,200 km this year. FTP 225 W, threshold heart rate 160 bpm, easy running around 5:30 per km. I can handle a long ride at the weekend and two hard-ish weekday sessions.",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "How much time can you train each week?",
    answer:
      "Around eight hours. Sixty to ninety minutes on weekday evenings after work, and longer rides at the weekend.",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "What is your body weight and body-fat percentage?",
    answer: "82.0 kg at 24.5 % body fat.",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "What is your diet goal?",
    answer:
      "Get down to 18 % body fat by September 2027 without losing power or muscle.",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "What are your constraints and preferences?",
    answer:
      "Lower back tightness after long rides and saddle discomfort beyond four hours. I will ride in rain, but I stay on the trainer after dark and I avoid ice. I like structure, but I burn out after about four months of disciplined training, so I need variety.",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "What equipment can you train on?",
    answer:
      "Road bike with a power meter, wheel-on indoor trainer, a gym at work, cross-country skis and running shoes.",
    skipped: false,
    answeredAt: "2026-10-18",
  },
  {
    prompt: "Do you have any injuries?",
    answer: null,
    skipped: true,
    answeredAt: "2026-10-18",
  },
];

const BENCHMARK_ACTIVITIES: PlanContextInput["recentActivities"] = [
  {
    summary: {
      id: 501,
      name: "Sunday Endurance Ride",
      type: "cycling",
      startDate: "2026-10-25T09:05:00Z",
      distance: 62_000,
      movingTime: 10_200,
      elapsedTime: 10_800,
      totalElevationGain: 820,
      averagePower: 168,
      normalizedPower: 198,
      averageSpeed: 6.08,
      maxSpeed: 12.4,
    },
    analysis:
      "A well-paced four-hour endurance ride. Normalized power of 198 W is 88 % of FTP, so the aerobic load landed where the week needed it. The last hour cost more than the first two because the climbs were ridden above the plan; keep the same duration next weekend but cap the climbs.",
    coachReply:
      "That is a solid ride. Next time keep the climbs two gears easier: you get the same aerobic benefit without spending the last hour paying for it.",
  },
  {
    summary: {
      id: 502,
      name: "Gym Strength",
      type: "strength_training",
      startDate: "2026-10-24T17:10:00Z",
      distance: 0,
      movingTime: 2_400,
      elapsedTime: 2_700,
      totalElevationGain: 0,
      strengthSets: [
        {
          setType: "active",
          durationSeconds: 45,
          repetitions: 10,
          weightKg: 16,
          exercises: [{ category: "SQUAT" }],
        },
        {
          setType: "active",
          durationSeconds: 45,
          repetitions: 8,
          weightKg: 60,
          exercises: [{ category: "DEADLIFT" }],
        },
      ],
    },
    analysis:
      "A controlled strength session. The goblet squats at 16 kg and the trap-bar pull at 60 kg were both inside the prescribed effort, so the load is right to repeat before adding weight.",
  },
  {
    summary: {
      id: 503,
      name: "Easy Run",
      type: "running",
      startDate: "2026-10-23T06:40:00Z",
      distance: 8_100,
      movingTime: 2_700,
      elapsedTime: 2_760,
      totalElevationGain: 60,
      averageSpeed: 3,
      maxSpeed: 3.4,
    },
    analysis:
      "An easy 5:33 per km run, close to the athlete's conversational pace. Heart rate stayed low, so this is useful running durability without adding meaningful fatigue before the weekend.",
  },
  {
    summary: {
      id: 504,
      name: "Trainer Sweet Spot",
      type: "cycling",
      startDate: "2026-10-22T18:00:00Z",
      distance: 40_000,
      movingTime: 4_500,
      elapsedTime: 4_560,
      totalElevationGain: 0,
      averagePower: 205,
      normalizedPower: 228,
      averageSpeed: 8.9,
      maxSpeed: 10.2,
    },
    analysis:
      "Three sweet-spot blocks at 228 W normalized, just above the prescribed 88 % of FTP. The third block held its power, so the session did its job; the cadence stayed above 85 rpm throughout.",
  },
  {
    summary: {
      id: 506,
      name: "Recovery Spin",
      type: "cycling",
      startDate: "2026-10-20T18:30:00Z",
      distance: 28_000,
      movingTime: 3_600,
      elapsedTime: 3_700,
      totalElevationGain: 190,
      averagePower: 118,
      normalizedPower: 130,
      averageSpeed: 7.8,
      maxSpeed: 9.6,
    },
    analysis:
      "An easy hour at 118 W average. That is genuine recovery work: it moved the legs without adding load, which is what the day after a weekend ride needs.",
  },
  {
    summary: {
      id: 505,
      name: "Bymarka Hike",
      type: "hiking",
      startDate: "2026-10-18T10:00:00Z",
      distance: 11_000,
      movingTime: 8_100,
      elapsedTime: 8_400,
      totalElevationGain: 320,
      averageSpeed: 1.36,
      maxSpeed: 1.9,
    },
    analysis:
      "An eleven-kilometre hike with 320 m of climbing. The effort stayed aerobic and the ankles had no reaction, so hiking remains a good low-impact weekend option while the weather holds.",
  },
];

const BENCHMARK_ACTIVITY_COMMENTS: readonly ActivityCommentContext[] = [
  {
    activityId: "501",
    comment:
      "Felt strong until the last hour, when my lower back tightened on the climbs.",
    updatedAt: "2026-10-25T18:00:00Z",
  },
];

const BENCHMARK_MANUAL_ACTIVITIES: NonNullable<
  PlanContextInput["manualActivities"]
> = [
  {
    id: 9001,
    startDate: "2026-10-21",
    details:
      "Ninety easy minutes of cross-country skiing on the lit trail, no watch and no heart-rate data.",
    estimatedTss: 45,
    updatedAt: "2026-10-21T21:00:00Z",
  },
];

const BENCHMARK_FTP_HISTORY: readonly Pick<
  MetricPoint,
  "date" | "value" | "source"
>[] = [
  { date: "2026-06-14", value: 218, source: "user" },
  { date: "2026-08-30", value: 222, source: "user" },
  { date: "2026-10-12", value: 228, source: "coach" },
];

const BENCHMARK_THRESHOLDS: readonly ThresholdSummary[] = [
  {
    date: "2026-10-12",
    sport: "cycling",
    measure: "ftp",
    label: "FTP",
    unit: "W",
    kind: "power",
    value: 225,
    source: "user",
  },
  {
    date: "2026-10-12",
    sport: "cycling",
    measure: "threshold_heart_rate",
    label: "Threshold heart rate",
    unit: "bpm",
    kind: "heart_rate",
    value: 160,
    source: "user",
  },
  {
    date: "2026-10-12",
    sport: "running",
    measure: "threshold_pace",
    label: "Threshold pace",
    unit: "s/km",
    kind: "pace",
    value: 330,
    source: "user",
  },
];

const BENCHMARK_BODY_HISTORY: PlanContextInput["bodyHistory"] = {
  weight: [
    { date: "2026-09-01", value: 83.5, source: "user" },
    { date: "2026-10-01", value: 82.4, source: "user" },
    { date: "2026-10-25", value: 82, source: "garmin" },
  ],
  bodyFat: [
    { date: "2026-09-01", value: 25.2, source: "user" },
    { date: "2026-10-01", value: 24.8, source: "user" },
    { date: "2026-10-25", value: 24.5, source: "coach" },
  ],
};

const BENCHMARK_DIET_GOAL: DietPlan = {
  goal: "Reach 18 % body fat by September 2027 while keeping FTP at 225 W or above.",
  goalProvided: true,
  goalBodyFatPercent: 18,
  goalDate: "2027-09-05",
  goalMissReason: null,
  assessment:
    "Weight is drifting down by about 0.3 kg a week while power holds, so the deficit is doing its job. Keep it small and fuel the long rides; losing weight faster would cost the build.",
};

const BENCHMARK_CURRENT_FORM: TrainingLoad = {
  tss: 65,
  atl: 46,
  ctl: 43,
  tsb: -3,
};

const BENCHMARK_FORECAST: readonly DailyWeather[] = [
  {
    date: "2026-10-26",
    icon: "rain",
    temperatureMinC: 4,
    temperatureMaxC: 8,
    windMaxMs: 4,
    gustMaxMs: 8,
    precipitationMm: 2.6,
    sunrise: "08:00",
    sunset: "15:43",
  },
  {
    date: "2026-10-27",
    icon: "very_cloudy",
    temperatureMinC: 3,
    temperatureMaxC: 7,
    windMaxMs: 3,
    gustMaxMs: 6,
    precipitationMm: 0.2,
    sunrise: "08:03",
    sunset: "15:40",
  },
  {
    date: "2026-10-28",
    icon: "partly_cloudy",
    temperatureMinC: 2,
    temperatureMaxC: 6,
    windMaxMs: 2,
    gustMaxMs: 5,
    precipitationMm: 0,
    sunrise: "08:06",
    sunset: "15:37",
  },
  {
    date: "2026-10-29",
    icon: "rain",
    temperatureMinC: 5,
    temperatureMaxC: 9,
    windMaxMs: 6,
    gustMaxMs: 13,
    precipitationMm: 4.1,
    sunrise: "08:09",
    sunset: "15:34",
  },
  {
    date: "2026-10-30",
    icon: "rain",
    temperatureMinC: 6,
    temperatureMaxC: 9,
    windMaxMs: 7,
    gustMaxMs: 16,
    precipitationMm: 6.2,
    sunrise: "08:12",
    sunset: "15:31",
  },
  {
    date: "2026-10-31",
    icon: "rain",
    temperatureMinC: 4,
    temperatureMaxC: 7,
    windMaxMs: 5,
    gustMaxMs: 11,
    precipitationMm: 1.4,
    sunrise: "08:15",
    sunset: "15:28",
  },
  {
    date: "2026-11-01",
    icon: "rain",
    temperatureMinC: 6,
    temperatureMaxC: 8,
    windMaxMs: 7,
    gustMaxMs: 14,
    precipitationMm: 7.8,
    sunrise: "08:18",
    sunset: "15:25",
  },
  {
    date: "2026-11-02",
    icon: "very_cloudy",
    temperatureMinC: 2,
    temperatureMaxC: 6,
    windMaxMs: 3,
    gustMaxMs: 5,
    precipitationMm: 0.3,
    sunrise: "08:21",
    sunset: "15:22",
  },
  {
    date: "2026-11-03",
    icon: "snow",
    temperatureMinC: -2,
    temperatureMaxC: 2,
    windMaxMs: 4,
    gustMaxMs: 9,
    precipitationMm: 3.5,
    sunrise: "08:24",
    sunset: "15:19",
  },
  {
    date: "2026-11-04",
    icon: "rain",
    temperatureMinC: 2,
    temperatureMaxC: 5,
    windMaxMs: 5,
    gustMaxMs: 10,
    precipitationMm: 2.1,
    sunrise: "08:27",
    sunset: "15:16",
  },
];

/** Daily health for the ten days before `today`, ending on the day before it. */
function benchmarkDailyHealth(today: string): DailyHealthPoint[] {
  const points: DailyHealthPoint[] = [];
  const sleepMinutes = [452, 438, 470, 415, 462, 445, 480, 430, 455, 468];
  const sleepScores = [82, 78, 88, 71, 84, 80, 90, 74, 83, 86];
  const hrv = [54, 51, 61, 45, 57, 53, 63, 47, 56, 59];
  const restingHeartRate = [49, 51, 47, 54, 48, 50, 46, 53, 49, 48];
  const bodyBatteryHigh = [78, 71, 86, 62, 80, 74, 88, 66, 79, 84];
  const readiness = [72, 64, 85, 51, 76, 68, 87, 57, 74, 81];
  for (let index = 0; index < 10; index += 1) {
    const date = addDays(today, index - 10);
    const push = (metric: DailyHealthPoint["metric"], value: number) => {
      points.push({ metric, date, value });
    };
    push("sleep_duration", sleepMinutes[index] ?? 450);
    push("sleep_score", sleepScores[index] ?? 80);
    push("hrv", hrv[index] ?? 55);
    push("resting_heart_rate", restingHeartRate[index] ?? 49);
    push("body_battery_high", bodyBatteryHigh[index] ?? 80);
    push("training_readiness", readiness[index] ?? 70);
  }
  return points;
}

/** The coach's earlier calorie targets, newest first. */
function benchmarkCalorieHistory(today: string): CalorieTargetPoint[] {
  return [1, 2, 3, 4, 5].map((daysAgo) => ({
    date: addDays(today, -daysAgo),
    caloriesKcal: 2400 + daysAgo * 40,
  }));
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The stored season the benchmark athlete is part way through. */
export function benchmarkSeasonPlan(): SeasonPlan {
  return {
    goal: "Complete the 2027 brevet series and Paris-Brest-Paris comfortably, while losing body fat without losing power.",
    introduction:
      "Hi Alex, I am your coach. We have got a long way to go to PBP, and I am looking forward to building it with you.",
    startDate: "2026-10-19",
    endDate: "2027-04-04",
    estimatedFtpWatts: 225,
    rationale:
      "The season is aerobic-first: a long base that uses the trainer, skiing and hiking to build durability through a Norwegian winter, then a sustained-power build and a brevet-specific block, with a two-week taper into the April 200 km event. Keeping the hard work in short, varied doses protects against the burnout the athlete describes after four disciplined months.",
    blocks: [
      {
        name: "Aerobic Base and Strength Foundation",
        focus:
          "Build aerobic durability, efficient cadence and low-load strength without stacking fatigue.",
        startDate: "2026-10-19",
        endDate: "2026-12-06",
        weekCount: 7,
      },
      {
        name: "Winter Build and Cross-Training",
        focus:
          "Hold cycling specificity through controlled threshold work while skiing and easy running carry the aerobic load.",
        startDate: "2026-12-07",
        endDate: "2027-01-17",
        weekCount: 6,
      },
      {
        name: "Endurance and Sustained-Power Build",
        focus:
          "Progress sustained threshold power, long weekend endurance and fuelling practice across late winter and early spring.",
        startDate: "2027-01-18",
        endDate: "2027-02-28",
        weekCount: 6,
      },
      {
        name: "Brevet-Specific Preparation",
        focus:
          "Convert fitness into 200 km durability with conservative pacing, fuelling and back-to-back weekend riding.",
        startDate: "2027-03-01",
        endDate: "2027-03-21",
        weekCount: 3,
      },
      {
        name: "Taper and Race Readiness",
        focus:
          "Reduce volume while keeping one brief opener, then arrive at the brevet fresh and fuelled.",
        startDate: "2027-03-22",
        endDate: "2027-04-04",
        weekCount: 2,
      },
    ],
  };
}

/** The detailed block the athlete is currently inside. */
export function benchmarkBlockPlan(): BlockPlan {
  return {
    name: "Aerobic Base and Strength Foundation",
    focus:
      "Build aerobic durability, efficient cadence and low-load strength without stacking fatigue.",
    startDate: "2026-10-19",
    endDate: "2026-12-06",
    estimatedFtpWatts: 225,
    rationale:
      "Seven weeks of consistent aerobic work with two short strength sessions, a growing weekend ride and one controlled sweet-spot session a week once the rhythm is established. Volume rises for three weeks, holds for two, then deloads before the winter block, so the athlete absorbs the load instead of arriving at December tired.",
    weeks: [
      {
        number: 1,
        startDate: "2026-10-19",
        focus:
          "Restore the weekly rhythm with easy aerobic work and two short strength sessions",
        targetLoad: "5.0-5.5 hours; about 230 TSS",
        estimatedFtpWatts: 225,
      },
      {
        number: 2,
        startDate: "2026-10-26",
        focus:
          "Hold the rhythm and add one controlled sweet-spot session on the trainer",
        targetLoad: "6.0-6.5 hours; about 290 TSS",
        estimatedFtpWatts: 225,
      },
      {
        number: 3,
        startDate: "2026-11-02",
        focus:
          "Extend the weekend ride and keep every aerobic effort under the heart-rate cap",
        targetLoad: "6.5-7.0 hours; about 320 TSS",
        estimatedFtpWatts: 226,
      },
      {
        number: 4,
        startDate: "2026-11-09",
        focus:
          "Peak block volume with one longer endurance ride and steady strength loads",
        targetLoad: "7.0-7.5 hours; about 350 TSS",
        estimatedFtpWatts: 227,
      },
      {
        number: 5,
        startDate: "2026-11-16",
        focus:
          "Consolidate the aerobic base and test cadence discipline on the trainer",
        targetLoad: "6.5-7.0 hours; about 310 TSS",
        estimatedFtpWatts: 227,
      },
      {
        number: 6,
        startDate: "2026-11-23",
        focus:
          "Deload week: cut volume by a quarter and keep the strength sessions short",
        targetLoad: "4.5-5.0 hours; about 210 TSS",
        estimatedFtpWatts: 226,
      },
      {
        number: 7,
        startDate: "2026-11-30",
        focus:
          "Finish the block with an easy long ride and head into winter training fresh",
        targetLoad: "5.5-6.0 hours; about 260 TSS",
        estimatedFtpWatts: 227,
      },
    ],
  };
}

function sessionStatus(
  date: string,
  template: WeekSessionTemplate,
  today: string,
): WeekSessionStatus {
  if (template.type === "rest") return "rest";
  if (date < today) return template.missed === true ? "missed" : "completed";
  return "planned";
}

/**
 * The current week as it stood on `today`. Days before today show what the
 * athlete recorded, so the daily prompt and the season revision see the same
 * week at different points in time.
 */
export function benchmarkWeekPlan(today: string): WeekPlan {
  const sessions = WEEK_SESSIONS.map((template, index): WeekSession => {
    const date = addDays(WEEK_START, index);
    const status = sessionStatus(date, template, today);
    const description =
      status === "completed"
        ? `Completed: ${template.completedDescription}`
        : status === "missed"
          ? "The athlete did not record a workout for this day."
          : template.plannedDescription;
    return {
      date,
      day: WEEK_DAYS[index] ?? "Monday",
      type: template.type,
      title: template.title,
      description,
      durationMinutes: template.durationMinutes,
      intensity: template.intensity,
      status,
      outdoor: template.outdoor,
      canBeOutdoor: template.canBeOutdoor,
      ...(template.bikeWorkout === undefined
        ? {}
        : { bikeWorkout: template.bikeWorkout }),
      estimatedTss: template.estimatedTss,
    };
  });
  return {
    startDate: WEEK_START,
    focus:
      "Hold the rhythm and add one controlled sweet-spot session on the trainer.",
    rationale:
      "Week one established the routine without a reaction from the back or the ankles, so this week adds one sweet-spot session and keeps the weekend hike aerobic. The weekday rides stay inside the after-work window and the trainer covers the dark evenings.",
    estimatedFtpWatts: 225,
    sessions,
  };
}

/** The fully detailed day plan the app stores for `date`. */
export function benchmarkDayPlan(date: string): DayPlan {
  const index = WEEK_DAYS.findIndex(
    (_, dayIndex) => addDays(WEEK_START, dayIndex) === date,
  );
  const template = WEEK_SESSIONS[index];
  if (template === undefined) {
    throw new Error(`No benchmark day plan for ${date}`);
  }
  const isRest = template.type === "rest";
  return {
    date,
    type: template.type,
    title: template.title,
    description: template.plannedDescription,
    durationMinutes: template.durationMinutes,
    intensity: template.intensity,
    alternatives: isRest
      ? []
      : [
          "Cut the session to twenty easy minutes if the legs are heavy.",
          "Move it indoors if the roads are icy.",
        ],
    rationale: isRest
      ? "A full rest day lets the weekend load settle before the next strength session."
      : "This keeps the week's shape and builds the aerobic durability the brevet needs without adding more fatigue than the athlete can absorb.",
    optional: isRest,
    optionalRationale: isRest
      ? "Skipping a rest day costs nothing; the mobility routine is the only part worth keeping."
      : "Skipping it would leave the week short of the target load that the next block is built on.",
    status: sessionStatus(date, template, date),
    outdoor: template.outdoor,
    canBeOutdoor: template.canBeOutdoor,
    ...(template.bikeWorkout === undefined
      ? {}
      : { bikeWorkout: template.bikeWorkout }),
    estimatedTss: template.estimatedTss,
    estimatedCaloriesKcal: isRest ? 2050 : 2350,
    calorieBreakdown: {
      basalMetabolismKcal: 1850,
      workoutCaloriesKcal: isRest ? 500 : 800,
      dietDeficitKcal: isRest ? 300 : 300,
    },
  };
}

/** The complete athlete context the plan prompts receive. */
export function benchmarkPlanContext(today: string): PlanContextInput {
  return {
    today,
    timezone: "Europe/Oslo",
    athleteAnswers: BENCHMARK_ANSWERS,
    recentActivities: BENCHMARK_ACTIVITIES,
    manualActivities: BENCHMARK_MANUAL_ACTIVITIES,
    activityComments: BENCHMARK_ACTIVITY_COMMENTS,
    weeklyNote:
      "I can only ride after 19:00 on weekdays, so keep those sessions on the trainer or short and local. Saturday morning is free for a longer outdoor session.",
    weeklyNoteWeekStartDate: WEEK_START,
    weeklyNoteReply:
      "Understood: weekday sessions stay indoors and inside the evening window, and Saturday carries the long outdoor work.",
    periodReviews: [
      {
        kind: "week",
        title: "Aerobic base, week 1",
        startDate: "2026-10-19",
        endDate: "2026-10-25",
        summary:
          "A steady first week: the strength sessions were completed, the easy rides stayed aerobic, and the weekend ride was four hours with 198 W normalized power. The missed Thursday trainer ride was not made up.",
        comment:
          "The long ride felt good until the last hour, when my back tightened on the climbs.",
        reply:
          "That is the back telling you the climbs were ridden too hard, not that the ride was too long. We keep the duration and ease the climbs.",
        weeklyNote: {
          note: "First week back after a quiet month; I want to keep it controlled.",
          reply: "Controlled is exactly right. The load comes later.",
        },
        updatedAt: "2026-10-25T20:00:00Z",
      },
    ],
    forecast: BENCHMARK_FORECAST,
    locationName: "Trondheim, Norway",
    athleteFtpWatts: 225,
    ftpHistory: BENCHMARK_FTP_HISTORY,
    thresholds: BENCHMARK_THRESHOLDS,
    bodyHistory: BENCHMARK_BODY_HISTORY,
    dailyHealth: benchmarkDailyHealth(today),
    dietGoal: BENCHMARK_DIET_GOAL,
    dietAdvice: true,
    calorieHistory: benchmarkCalorieHistory(today),
    currentForm: BENCHMARK_CURRENT_FORM,
  };
}
