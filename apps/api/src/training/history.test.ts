import { describe, expect, it } from "bun:test";
import type {
  AnalyzedActivity,
  AthleteThreshold,
  CoachPlan,
  DailyHealthPoint,
  FitnessRange,
  MetricPoint,
  ThresholdHistorySeries,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/activityContext.js";
import { buildActivityLoads } from "./activityLoad.js";
import type { TrainingContext } from "./context.js";
import { loadFitnessHistory } from "./history.js";
import { buildThresholdTimelines, FTP_THRESHOLD } from "./thresholds.js";

type FitnessHistoryDependencies = NonNullable<
  Parameters<typeof loadFitnessHistory>[7]
>;

const thresholdPoints: AthleteThreshold[] = [
  {
    date: "2026-10-01",
    value: 250,
    source: "user",
    sport: "cycling",
    measure: "ftp",
    label: "FTP",
    unit: "W",
    kind: "power",
  },
];

function activity(overrides: Partial<AnalyzedActivity> = {}): AnalyzedActivity {
  return {
    id: 1,
    name: "Ride",
    type: "cycling",
    startDate: "2026-10-20T09:00:00Z",
    distance: 30000,
    movingTime: 3600,
    elapsedTime: 3600,
    totalElevationGain: 0,
    sampleCount: 10,
    samples: [],
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}

function plan(overrides: Partial<CoachPlan> = {}): CoachPlan {
  return {
    season: {
      goal: "Ride a century.",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      blocks: [],
      rationale: "Build endurance.",
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      startDate: "2026-10-19",
      endDate: "2026-11-29",
      rationale: "Build the base.",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
          estimatedFtpWatts: 255,
        },
        {
          number: 2,
          startDate: "2026-10-26",
          focus: "Aerobic",
          targetLoad: "Easy",
          estimatedFtpWatts: 262,
        },
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic",
      rationale: "Keep it easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout" as const,
        title: "Ride",
        description: "Easy spin.",
        durationMinutes: 60,
        intensity: "easy" as const,
        status: "planned" as const,
        ...(index >= 3 ? { estimatedFtpWatts: 255 + index - 3 } : {}),
      })),
    },
    today: {
      date: "2026-10-22",
      type: "workout",
      title: "Ride",
      description: "Easy spin.",
      durationMinutes: 60,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      status: "planned",
    },
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    ...overrides,
  };
}

interface HistoryOptions {
  /** `null` means the athlete has no stored plan yet; omitted uses the fixture. */
  plan?: CoachPlan | null;
  today?: string;
  range?: FitnessRange;
  timeZone?: string | null;
  activities?: readonly AnalyzedActivity[];
  dietAdvice?: boolean;
  /** Overrides for the stored training context the loader reads. */
  context?: Partial<TrainingContext>;
  weight?: readonly MetricPoint[];
  bodyFat?: readonly MetricPoint[];
  dailyHealth?: readonly DailyHealthPoint[];
  nutrition?: {
    consumed: ReadonlyMap<string, number>;
    needed: ReadonlyMap<string, number>;
  } | null;
}

function historyDependencies(
  options: HistoryOptions,
): FitnessHistoryDependencies {
  const context: TrainingContext = {
    ftpTimeline: null,
    thresholds: [],
    thresholdPoints,
    thresholdTimelines: buildThresholdTimelines(thresholdPoints),
    planTssByDate: new Map(),
    manualTssByDate: new Map(),
    manualActivities: [],
    ...options.context,
  };
  return {
    loadTrainingContext: () => Promise.resolve(context),
    loadMetricPoints: (_userId, metric) =>
      Promise.resolve([
        ...(metric === "weight"
          ? (options.weight ?? [])
          : (options.bodyFat ?? [])),
      ]),
    loadDailyHealth: () => Promise.resolve([...(options.dailyHealth ?? [])]),
    loadNutrition: (_userId, _plan, _today, dietAdvice) =>
      Promise.resolve(dietAdvice ? (options.nutrition ?? null) : null),
  };
}

function loadFitness(options: HistoryOptions = {}) {
  const storedPlan =
    options.plan === undefined ? plan() : (options.plan ?? undefined);
  return loadFitnessHistory(
    1,
    options.activities ?? [],
    storedPlan,
    options.today ?? "2026-10-22",
    options.range ?? "week",
    options.dietAdvice ?? false,
    options.timeZone ?? null,
    historyDependencies(options),
  );
}

describe("fitness history window", () => {
  it("starts the fixed ranges the right distance back", async () => {
    const week = await loadFitness({ plan: null });
    expect(week.days).toHaveLength(7);
    expect(week.days[0]?.date).toBe("2026-10-16");
    expect(week.days.at(-1)?.date).toBe("2026-10-22");

    expect(
      (await loadFitness({ plan: null, range: "month" })).days[0]?.date,
    ).toBe("2026-09-23");
    expect(
      (await loadFitness({ plan: null, range: "quarter" })).days[0]?.date,
    ).toBe("2026-07-25");
    expect(
      (await loadFitness({ plan: null, range: "year" })).days[0]?.date,
    ).toBe("2025-10-23");
  });

  it("starts 'all' at the first recorded activity", async () => {
    expect(
      (
        await loadFitness({
          plan: null,
          range: "all",
          activities: [activity({ startDate: "2025-03-04T09:00:00Z" })],
        })
      ).days[0]?.date,
    ).toBe("2025-03-04");
    // Nothing recorded yet: fall back to the past week.
    expect(
      (await loadFitness({ plan: null, range: "all" })).days[0]?.date,
    ).toBe("2026-10-16");
  });

  it("ends where the planned workouts end", async () => {
    expect(
      (await loadFitness({ plan: null, today: "2026-10-21" })).days.at(-1)
        ?.date,
    ).toBe("2026-10-21");

    const laterPlan: CoachPlan = {
      ...plan(),
      week: {
        ...plan().week,
        sessions: plan().week.sessions.map((session, index) => ({
          ...session,
          date: `2026-12-${String(25 + index)}`,
        })),
      },
    };
    expect(
      (
        await loadFitness({
          today: "2026-10-21",
          plan: laterPlan,
        })
      ).days.at(-1)?.date,
    ).toBe("2026-12-31");
  });
});

describe("earliest recorded date", () => {
  it("takes the first imported or manual entry", async () => {
    const manualActivities: ManualActivityContext[] = [
      { id: 1, startDate: "2026-09-02", details: "Old gym session" },
      { id: 2, startDate: "2026-10-01", details: "Newer" },
    ];
    const history = await loadFitness({
      plan: null,
      range: "all",
      activities: [activity({ startDate: "2026-10-20T09:00:00Z" })],
      context: { manualActivities },
    });

    expect(history.days[0]?.date).toBe("2026-09-02");
  });

  it("reads an imported activity's date in the athlete's zone", async () => {
    // 06:30 UTC on 20 October is 23:30 on 19 October in Los Angeles.
    const evening = activity({ startDate: "2026-10-20T06:30:00Z" });

    expect(
      (
        await loadFitness({
          plan: null,
          range: "all",
          timeZone: "America/Los_Angeles",
          activities: [evening],
        })
      ).days[0]?.date,
    ).toBe("2026-10-19");
    expect(
      (
        await loadFitness({
          plan: null,
          range: "all",
          timeZone: "UTC",
          activities: [evening],
        })
      ).days[0]?.date,
    ).toBe("2026-10-20");
  });
});

describe("loadFitnessHistory", () => {
  it("returns one day per calendar day for the chosen range", async () => {
    const history = await loadFitness({ plan: null });

    expect(history.days).toHaveLength(7);
    expect(history.days[0]?.date).toBe("2026-10-16");
    expect(history.days.at(-1)?.date).toBe("2026-10-22");
  });

  it("reports logged and needed calories for each day", async () => {
    const history = await loadFitness({
      plan: null,
      dietAdvice: true,
      nutrition: {
        consumed: new Map([["2026-10-22", 2100]]),
        needed: new Map([["2026-10-22", 2400]]),
      },
    });

    expect(history.nutrition).toHaveLength(7);
    expect(history.nutrition.at(-1)).toEqual({
      date: "2026-10-22",
      consumedKcal: 2100,
      neededKcal: 2400,
    });
    expect(history.nutrition[0]).toEqual({
      date: "2026-10-16",
      consumedKcal: null,
      neededKcal: null,
    });
  });

  it("matches the activity load series for the same date", async () => {
    const activities = [activity({ normalizedPower: 200 })];
    const history = await loadFitness({ activities });
    const expected = buildActivityLoads(
      activities,
      buildThresholdTimelines(thresholdPoints),
      null,
    ).byDate.get("2026-10-20");

    const day = history.days.find((entry) => entry.date === "2026-10-20");

    expect(day?.tss).toBe(expected?.tss);
    expect(day?.atl).toBe(expected?.atl);
    expect(day?.ctl).toBe(expected?.ctl);
    expect(day?.tsb).toBe(expected?.tsb);
  });

  it("prefers measured power over the coach's estimate and a manual entry", async () => {
    const history = await loadFitness({
      activities: [activity({ normalizedPower: 200 })],
      context: {
        planTssByDate: new Map([["2026-10-20", 40]]),
        manualTssByDate: new Map([["2026-10-20", 30]]),
      },
    });

    expect(history.days.find((day) => day.date === "2026-10-20")?.tss).toBe(64);
  });

  it("uses the coach's estimate without power and a manual entry over it", async () => {
    const planned = await loadFitness({
      context: { planTssByDate: new Map([["2026-10-20", 80]]) },
    });
    expect(planned.days.find((day) => day.date === "2026-10-20")?.tss).toBe(80);

    const manual = await loadFitness({
      context: {
        planTssByDate: new Map([["2026-10-20", 80]]),
        manualTssByDate: new Map([["2026-10-20", 120]]),
      },
    });
    expect(manual.days.find((day) => day.date === "2026-10-20")?.tss).toBe(120);
  });

  it("lists the activities and manual entries logged on each day", async () => {
    const history = await loadFitness({
      activities: [
        activity({ id: 7, name: "Morning ride", type: "indoor_cycling" }),
        activity({ id: 8, name: "", type: "running", movingTime: 0 }),
      ],
      context: {
        manualActivities: [
          { id: 3, startDate: "2026-10-20", details: "Gym session" },
        ],
      },
    });

    expect(
      history.days.find((day) => day.date === "2026-10-20")?.activities,
    ).toEqual([
      {
        id: "activity-7",
        name: "Morning ride",
        type: "indoor_cycling",
        durationMinutes: 60,
      },
      // An unnamed activity falls back to its formatted type, and a missing
      // duration is left out rather than shown as zero.
      { id: "activity-8", name: "Running", type: "running" },
      { id: "manual-3", name: "Gym session", type: "manual" },
    ]);
    expect(
      history.days.find((day) => day.date === "2026-10-21")?.activities,
    ).toEqual([]);
  });

  it("charts an activity on the athlete's local day", async () => {
    // 06:30 UTC on 22 October is 23:30 on 21 October in Los Angeles.
    const evening = activity({
      id: 9,
      name: "Evening ride",
      startDate: "2026-10-22T06:30:00Z",
    });

    const local = await loadFitness({
      timeZone: "America/Los_Angeles",
      activities: [evening],
    });
    expect(
      local.days.find((day) => day.date === "2026-10-21")?.activities,
    ).toEqual([
      {
        id: "activity-9",
        name: "Evening ride",
        type: "cycling",
        durationMinutes: 60,
      },
    ]);
    expect(
      local.days.find((day) => day.date === "2026-10-22")?.activities,
    ).toEqual([]);
    expect(local.days.find((day) => day.date === "2026-10-21")?.tss).toBe(55);

    const utc = await loadFitness({ activities: [evening] });
    expect(utc.days.find((day) => day.date === "2026-10-22")?.tss).toBe(55);
    expect(utc.days.find((day) => day.date === "2026-10-21")?.tss).toBe(0);
  });

  it("keeps TSB equal to CTL minus ATL on every day", async () => {
    const history = await loadFitness({
      context: { planTssByDate: new Map([["2026-10-20", 80]]) },
    });

    for (const day of history.days) {
      // CTL and ATL are stored rounded to one decimal, so the difference can
      // differ from the exactly computed TSB by up to a tenth.
      expect(Math.abs(day.tsb - (day.ctl - day.atl))).toBeLessThan(0.11);
    }
  });

  it("carries the plan's session on the days it covers", async () => {
    const history = await loadFitness();

    expect(
      history.days.find((day) => day.date === "2026-10-22")?.planned,
    ).toEqual({ title: "Ride", type: "workout", durationMinutes: 60 });
    // Days before the plan's first session have no planned workout.
    expect(
      history.days.find((day) => day.date === "2026-10-16")?.planned,
    ).toBeNull();
  });

  it("carries the season end and diet targets when diet advice is on", async () => {
    const withTargets = plan({
      season: {
        ...plan().season,
        dietProgress: {
          targetWeightKg: 78,
          targetBodyFatPercent: 15,
          note: "Reach race weight.",
        },
        blocks: [
          {
            name: "Base",
            focus: "Aerobic",
            startDate: "2026-10-19",
            endDate: "2026-11-29",
            weekCount: 6,
            dietProgress: {
              targetWeightKg: 82,
              targetBodyFatPercent: null,
              note: "Hold weight.",
            },
          },
        ],
      },
      block: {
        ...plan().block,
        dietProgress: {
          targetWeightKg: 81,
          targetBodyFatPercent: null,
          note: "Hold weight.",
        },
      },
      week: {
        ...plan().week,
        dietProgress: {
          targetWeightKg: 82.5,
          targetBodyFatPercent: null,
          note: "Hold weight.",
        },
      },
    });
    const history = await loadFitness({
      plan: withTargets,
      dietAdvice: true,
    });

    expect(history.seasonEndDate).toBe("2027-04-01");
    expect(history.dietTargets[0]).toEqual({
      date: "2026-10-25",
      weightKg: 82.5,
      bodyFatPercent: null,
    });
    expect(history.dietTargets.at(-1)).toEqual({
      date: "2027-04-01",
      weightKg: 78,
      bodyFatPercent: 15,
    });

    const withoutDiet = await loadFitness({ plan: withTargets });
    expect(withoutDiet.dietTargets).toEqual([]);
    expect(withoutDiet.seasonEndDate).toBe("2027-04-01");
  });

  it("carries a planned rest day too", async () => {
    const restPlan: CoachPlan = {
      ...plan(),
      week: {
        ...plan().week,
        sessions: plan().week.sessions.map((session, index) =>
          index === 3
            ? {
                ...session,
                type: "rest" as const,
                title: "Rest day",
                intensity: "rest" as const,
                durationMinutes: 0,
              }
            : session,
        ),
      },
    };
    const history = await loadFitness({ plan: restPlan });

    expect(
      history.days.find((day) => day.date === "2026-10-22")?.planned,
    ).toEqual({ title: "Rest day", type: "rest", durationMinutes: 0 });
  });

  it("plots the coach's daily estimate from today and the stated FTP before it", async () => {
    const history = await loadFitness({ range: "month" });

    expect(ftpOn(history.thresholds, "2026-10-15")).toBe(250);
    expect(ftpOn(history.thresholds, "2026-10-21")).toBe(250);
    expect(ftpOn(history.thresholds, "2026-10-22")).toBe(255);
    expect(ftpOn(history.thresholds, "2026-10-23")).toBe(256);
    expect(ftpOn(history.thresholds, "2026-10-25")).toBe(258);
  });

  it("interpolates between the week estimates without daily values", async () => {
    const weeklyPlan: CoachPlan = {
      ...plan(),
      week: {
        ...plan().week,
        estimatedFtpWatts: 255,
        sessions: plan().week.sessions.map((session) => ({
          ...session,
          estimatedFtpWatts: undefined,
        })),
      },
    };
    const history = await loadFitness({ plan: weeklyPlan, range: "month" });

    // Today keeps the current week's estimate; the following days climb
    // towards the next week's 262 instead of holding 255 until it starts.
    expect(ftpOn(history.thresholds, "2026-10-22")).toBe(255);
    expect(ftpOn(history.thresholds, "2026-10-23")).toBe(257);
    expect(ftpOn(history.thresholds, "2026-10-25")).toBe(260);
  });

  it("interpolates towards the next week at the end of the week window", async () => {
    const weeklyPlan: CoachPlan = {
      ...plan(),
      today: { ...plan().today, date: "2026-10-30" },
      week: {
        ...plan().week,
        startDate: "2026-10-26",
        estimatedFtpWatts: 220,
        sessions: plan().week.sessions.map((session, index) => ({
          ...session,
          date: index === 6 ? "2026-11-01" : `2026-10-${String(26 + index)}`,
          estimatedFtpWatts: undefined,
        })),
      },
      block: {
        ...plan().block,
        weeks: [
          {
            number: 1,
            startDate: "2026-10-26",
            focus: "Aerobic",
            targetLoad: "Easy",
            estimatedFtpWatts: 220,
          },
          {
            number: 2,
            startDate: "2026-11-02",
            focus: "Aerobic",
            targetLoad: "Easy",
            estimatedFtpWatts: 222,
          },
        ],
      },
    };
    const history = await loadFitness({
      today: "2026-10-30",
      plan: weeklyPlan,
      context: {
        thresholdTimelines: buildThresholdTimelines([
          { ...FTP_THRESHOLD, date: "2026-10-01", value: 220, source: "user" },
        ]),
      },
    });

    // The chart window ends on Sunday 1 November, but the line has already
    // moved towards the following week's 222 W.
    expect(ftpOn(history.thresholds, "2026-10-30")).toBe(220);
    expect(ftpOn(history.thresholds, "2026-10-31")).toBe(221);
    expect(ftpOn(history.thresholds, "2026-11-01")).toBe(221);
  });

  it("has no FTP points when the athlete has not stated one", async () => {
    const history = await loadFitness({
      plan: null,
      context: { thresholdPoints: [], thresholdTimelines: [] },
    });

    expect(history.thresholds).toEqual([]);
  });

  it("interpolates body weight and body fat over the window", async () => {
    const history = await loadFitness({
      plan: null,
      weight: [
        { date: "2026-10-01", value: 80, source: "garmin" },
        { date: "2026-10-11", value: 78, source: "garmin" },
      ],
      bodyFat: [{ date: "2026-10-06", value: 20, source: "garmin" }],
    });

    expect(history.body.weight[0]).toEqual({
      date: "2026-10-16",
      value: 77,
    });
    expect(history.body.bodyFat[0]).toEqual({
      date: "2026-10-16",
      value: 20,
    });
  });

  it("has empty body series when the athlete has no measurements", async () => {
    const history = await loadFitness();

    expect(history.body).toEqual({ weight: [], bodyFat: [] });
  });

  it("returns the newest Garmin daily, body and FTP readings", async () => {
    const garminFtp: AthleteThreshold = {
      date: "2026-10-02",
      value: 255,
      source: "garmin",
      sport: "cycling",
      measure: "ftp",
      label: "FTP",
      unit: "W",
      kind: "power",
    };
    const coachFtp: AthleteThreshold = {
      ...garminFtp,
      date: "2026-10-03",
      value: 260,
      source: "coach",
    };
    const history = await loadFitness({
      weight: [
        { date: "2026-10-18", value: 78.5, source: "garmin" },
        { date: "2026-10-19", value: 78.4, source: "garmin" },
        { date: "2026-10-20", value: 78.0, source: "user" },
      ],
      bodyFat: [{ date: "2026-10-18", value: 24.5, source: "garmin" }],
      context: { thresholdPoints: [...thresholdPoints, garminFtp, coachFtp] },
      dailyHealth: [
        { metric: "sleep_duration", date: "2026-10-20", value: 400 },
        { metric: "sleep_duration", date: "2026-10-21", value: 430 },
        { metric: "hrv", date: "2026-10-21", value: 48 },
      ],
    });

    expect(history.latestGarmin.dailyHealth).toEqual([
      { metric: "sleep_duration", date: "2026-10-21", value: 430 },
      { metric: "hrv", date: "2026-10-21", value: 48 },
    ]);
    expect(history.latestGarmin.weight).toEqual({
      date: "2026-10-19",
      value: 78.4,
    });
    expect(history.latestGarmin.bodyFat).toEqual({
      date: "2026-10-18",
      value: 24.5,
    });
    expect(history.latestGarmin.ftp).toEqual({
      date: "2026-10-02",
      value: 255,
    });
    expect(history.dailyHealth).toHaveLength(3);
  });

  it("uses the last completed day for today's running Body Battery values", async () => {
    const history = await loadFitness({
      dailyHealth: [
        { metric: "body_battery_high", date: "2026-10-21", value: 81 },
        { metric: "body_battery_high", date: "2026-10-22", value: 30 },
        { metric: "body_battery_low", date: "2026-10-21", value: 24 },
        { metric: "body_battery_low", date: "2026-10-22", value: 12 },
        { metric: "sleep_duration", date: "2026-10-22", value: 420 },
      ],
    });

    expect(history.latestGarmin.dailyHealth).toEqual([
      { metric: "sleep_duration", date: "2026-10-22", value: 420 },
      { metric: "body_battery_high", date: "2026-10-21", value: 81 },
      { metric: "body_battery_low", date: "2026-10-21", value: 24 },
    ]);
    expect(history.dailyHealth).toEqual([
      { metric: "body_battery_high", date: "2026-10-21", value: 81 },
      { metric: "body_battery_low", date: "2026-10-21", value: 24 },
      { metric: "sleep_duration", date: "2026-10-22", value: 420 },
    ]);
  });

  it("leaves absent Garmin readings empty", async () => {
    const history = await loadFitness();

    expect(history.latestGarmin).toEqual({
      dailyHealth: [],
      weight: null,
      bodyFat: null,
      ftp: null,
    });
  });
});

function ftpOn(
  series: readonly ThresholdHistorySeries[],
  date: string,
): number | undefined {
  const ftp = series.find(
    (entry) => entry.sport === "cycling" && entry.measure === "ftp",
  );
  return ftp?.points.find((point) => point.date === date)?.value;
}
