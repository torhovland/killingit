import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, CoachPlan } from "@killingit/shared";
import { buildActivityTrainingLoads } from "./activityLoad.js";
import { buildFtpTimeline } from "./ftp.js";
import { buildFitnessHistory, clampFitnessDays } from "./history.js";

const timeline = buildFtpTimeline({
  answers: [
    {
      answer: "FTP is 250 W.",
      answeredAt: new Date("2026-10-01T00:00:00Z"),
    },
  ],
});

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
  days: 7,
  activities: [] as readonly AnalyzedActivity[],
  timeline,
  plan: plan(),
  planTssByDate: new Map<string, number>(),
  manualTssByDate: new Map<string, number>(),
};

describe("clampFitnessDays", () => {
  it("keeps the window within the supported range", () => {
    expect(clampFitnessDays(1)).toBe(7);
    expect(clampFitnessDays(90)).toBe(90);
    expect(clampFitnessDays(10_000)).toBe(365);
    expect(clampFitnessDays(Number.NaN)).toBe(90);
  });
});

describe("buildFitnessHistory", () => {
  it("returns one day per calendar day, ending today", () => {
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

  it("keeps TSB equal to CTL minus ATL on every day", () => {
    const history = buildFitnessHistory({
      ...base,
      planTssByDate: new Map([["2026-10-20", 80]]),
    });

    for (const day of history.days) {
      // CTL and ATL are stored rounded to one decimal, so the difference can
      // differ from the exactly computed TSB by up to a tenth.
      expect(Math.abs(day.tsb - (day.ctl - day.atl))).toBeLessThanOrEqual(0.1);
    }
  });

  it("runs on to the last planned day", () => {
    const history = buildFitnessHistory({
      ...base,
      today: "2026-10-21",
      days: 7,
      planTssByDate: new Map([["2026-10-25", 60]]),
    });

    expect(history.days.at(-1)?.date).toBe("2026-10-25");
  });

  it("plots the coach's weekly estimate inside the plan and the stated FTP before it", () => {
    const history = buildFitnessHistory({ ...base, days: 14 });

    expect(ftpOn(history.ftp, "2026-10-15")).toBe(250);
    expect(ftpOn(history.ftp, "2026-10-19")).toBe(255);
    expect(ftpOn(history.ftp, "2026-10-25")).toBe(255);
  });

  it("has no FTP points when the athlete has not stated one", () => {
    const history = buildFitnessHistory({
      ...base,
      timeline: buildFtpTimeline({ answers: [] }),
      plan: undefined,
    });

    expect(history.ftp).toEqual([]);
  });
});

function ftpOn(
  points: readonly { date: string; watts: number }[],
  date: string,
): number | undefined {
  return points.find((point) => point.date === date)?.watts;
}
