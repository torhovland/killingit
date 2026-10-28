import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, CoachPlan } from "@killingit/shared";
import { buildActivityTrainingLoads } from "./activityLoad.js";
import { buildFtpTimelineFromPoints } from "./ftp.js";
import {
  buildFitnessHistory,
  earliestRecordedDate,
  fitnessWindow,
  FITNESS_RANGE_DAYS,
} from "./history.js";

const timeline = buildFtpTimelineFromPoints([
  { date: "2026-10-01", value: 250, source: "user" },
]);

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

const base = {
  today: "2026-10-22",
  range: "week" as const,
  activities: [] as readonly AnalyzedActivity[],
  timeline,
  plan: plan(),
  planTssByDate: new Map<string, number>(),
  manualTssByDate: new Map<string, number>(),
};

describe("fitnessWindow", () => {
  it("starts the fixed ranges the right distance back", () => {
    expect(fitnessWindow({ today: "2026-10-22", range: "week" })).toEqual({
      startDate: "2026-10-16",
      endDate: "2026-10-22",
    });
    expect(
      fitnessWindow({ today: "2026-10-22", range: "month" }).startDate,
    ).toBe("2026-09-23");
    expect(
      fitnessWindow({ today: "2026-10-22", range: "quarter" }).startDate,
    ).toBe("2026-07-25");
    expect(
      fitnessWindow({ today: "2026-10-22", range: "year" }).startDate,
    ).toBe("2025-10-23");
    expect(FITNESS_RANGE_DAYS.week).toBe(7);
  });

  it("starts 'all' at the first recorded activity", () => {
    expect(
      fitnessWindow({
        today: "2026-10-22",
        range: "all",
        earliestDate: "2025-03-04",
      }).startDate,
    ).toBe("2025-03-04");
    // Nothing recorded yet: fall back to the past week.
    expect(fitnessWindow({ today: "2026-10-22", range: "all" }).startDate).toBe(
      "2026-10-16",
    );
  });

  it("ends where the planned workouts end", () => {
    expect(fitnessWindow({ today: "2026-10-21", range: "week" }).endDate).toBe(
      "2026-10-21",
    );

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
      fitnessWindow({
        today: "2026-10-21",
        range: "week",
        plan: laterPlan,
      }).endDate,
    ).toBe("2026-12-31");
  });
});

describe("earliestRecordedDate", () => {
  it("takes the first imported or manual entry", () => {
    expect(
      earliestRecordedDate(
        [activity({ startDate: "2026-10-20T09:00:00Z" })],
        [
          { id: 1, startDate: "2026-09-02", details: "Old gym session" },
          { id: 2, startDate: "2026-10-01", details: "Newer" },
        ],
      ),
    ).toBe("2026-09-02");
    expect(earliestRecordedDate([], [])).toBeNull();
  });
});

describe("buildFitnessHistory", () => {
  it("returns one day per calendar day for the chosen range", () => {
    const history = buildFitnessHistory({ ...base, plan: undefined });

    expect(history.days).toHaveLength(7);
    expect(history.days[0]?.date).toBe("2026-10-16");
    expect(history.days.at(-1)?.date).toBe("2026-10-22");
  });

  it("matches the activity load series for the same date", () => {
    const activities = [activity({ normalizedPower: 200 })];
    const history = buildFitnessHistory({ ...base, activities });
    const expected = buildActivityTrainingLoads(activities, timeline).get(
      "2026-10-20",
    );

    const day = history.days.find((entry) => entry.date === "2026-10-20");

    expect(day?.tss).toBe(expected?.tss);
    expect(day?.atl).toBe(expected?.atl);
    expect(day?.ctl).toBe(expected?.ctl);
    expect(day?.tsb).toBe(expected?.tsb);
  });

  it("prefers measured power over the coach's estimate and a manual entry", () => {
    const history = buildFitnessHistory({
      ...base,
      activities: [activity({ normalizedPower: 200 })],
      planTssByDate: new Map([["2026-10-20", 40]]),
      manualTssByDate: new Map([["2026-10-20", 30]]),
    });

    expect(history.days.find((day) => day.date === "2026-10-20")?.tss).toBe(64);
  });

  it("uses the coach's estimate without power and a manual entry over it", () => {
    const planned = buildFitnessHistory({
      ...base,
      planTssByDate: new Map([["2026-10-20", 80]]),
    });
    expect(planned.days.find((day) => day.date === "2026-10-20")?.tss).toBe(80);

    const manual = buildFitnessHistory({
      ...base,
      planTssByDate: new Map([["2026-10-20", 80]]),
      manualTssByDate: new Map([["2026-10-20", 120]]),
    });
    expect(manual.days.find((day) => day.date === "2026-10-20")?.tss).toBe(120);
  });

  it("lists the activities and manual entries logged on each day", () => {
    const history = buildFitnessHistory({
      ...base,
      activities: [
        activity({ id: 7, name: "Morning ride", type: "indoor_cycling" }),
        activity({ id: 8, name: "", type: "running", movingTime: 0 }),
      ],
      manualActivities: [
        { id: 3, startDate: "2026-10-20", details: "Gym session" },
      ],
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

  it("keeps TSB equal to CTL minus ATL on every day", () => {
    const history = buildFitnessHistory({
      ...base,
      planTssByDate: new Map([["2026-10-20", 80]]),
    });

    for (const day of history.days) {
      // CTL and ATL are stored rounded to one decimal, so the difference can
      // differ from the exactly computed TSB by up to a tenth.
      expect(Math.abs(day.tsb - (day.ctl - day.atl))).toBeLessThan(0.11);
    }
  });

  it("carries the plan's session on the days it covers", () => {
    const history = buildFitnessHistory(base);

    expect(
      history.days.find((day) => day.date === "2026-10-22")?.planned,
    ).toEqual({ title: "Ride", type: "workout", durationMinutes: 60 });
    // Days before the plan's first session have no planned workout.
    expect(
      history.days.find((day) => day.date === "2026-10-16")?.planned,
    ).toBeNull();
  });

  it("carries a planned rest day too", () => {
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
    const history = buildFitnessHistory({ ...base, plan: restPlan });

    expect(
      history.days.find((day) => day.date === "2026-10-22")?.planned,
    ).toEqual({ title: "Rest day", type: "rest", durationMinutes: 0 });
  });

  it("plots the coach's weekly estimate inside the plan and the stated FTP before it", () => {
    const history = buildFitnessHistory({ ...base, range: "month" });

    expect(ftpOn(history.ftp, "2026-10-15")).toBe(250);
    expect(ftpOn(history.ftp, "2026-10-19")).toBe(255);
    expect(ftpOn(history.ftp, "2026-10-25")).toBe(255);
  });

  it("has no FTP points when the athlete has not stated one", () => {
    const history = buildFitnessHistory({
      ...base,
      timeline: buildFtpTimelineFromPoints([]),
      plan: undefined,
    });

    expect(history.ftp).toEqual([]);
  });

  it("interpolates body weight and body fat over the window", () => {
    const history = buildFitnessHistory({
      ...base,
      plan: undefined,
      bodyPoints: {
        weight: [
          { date: "2026-10-01", value: 80, source: "garmin" },
          { date: "2026-10-11", value: 78, source: "garmin" },
        ],
        bodyFat: [{ date: "2026-10-06", value: 20, source: "garmin" }],
      },
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

  it("has empty body series when the athlete has no measurements", () => {
    const history = buildFitnessHistory(base);

    expect(history.body).toEqual({ weight: [], bodyFat: [] });
  });
});

function ftpOn(
  points: readonly { date: string; watts: number }[],
  date: string,
): number | undefined {
  return points.find((point) => point.date === date)?.watts;
}
