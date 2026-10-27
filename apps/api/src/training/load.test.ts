import { describe, expect, it } from "bun:test";
import type {
  AnalyzedActivity,
  CoachPlan,
  DayPlan,
  WeekPlan,
  WeekSession,
} from "@killingit/shared";
import { applyTrainingLoad } from "./load.js";
import type { AthleteAnswerContext } from "../llm/planContext.js";

const ftpAnswer: AthleteAnswerContext = {
  prompt: "What is your current performance?",
  answer: "My FTP is 250 W.",
  skipped: false,
};

function activity(overrides: Partial<AnalyzedActivity> = {}): AnalyzedActivity {
  return {
    id: 1,
    name: "Tuesday ride",
    type: "cycling",
    startDate: "2026-10-20T09:00:00Z",
    distance: 30000,
    movingTime: 3600,
    elapsedTime: 3600,
    totalElevationGain: 0,
    sampleCount: 100,
    normalizedPower: 200,
    averagePower: 195,
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}

function session(
  date: string,
  overrides: Partial<WeekSession> = {},
): WeekSession {
  return {
    date,
    day: "Monday",
    type: "workout",
    title: "Session",
    description: "Training.",
    durationMinutes: 60,
    intensity: "moderate",
    status: "planned",
    ...overrides,
  };
}

function day(date: string, overrides: Partial<DayPlan> = {}): DayPlan {
  return {
    date,
    type: "workout",
    title: "Session",
    description: "Training.",
    durationMinutes: 60,
    intensity: "moderate",
    alternatives: [],
    rationale: "Because it supports the goal.",
    optional: false,
    status: "planned",
    ...overrides,
  };
}

const week: WeekPlan = {
  startDate: "2026-10-19",
  focus: "Base",
  rationale: "Steady aerobic work.",
  estimatedFtpWatts: 250,
  sessions: [
    session("2026-10-19", { type: "rest", intensity: "rest", status: "rest" }),
    session("2026-10-20", { status: "completed", estimatedTss: 70 }),
    session("2026-10-21", {
      title: "Sweet spot",
      status: "planned",
      bikeWorkout: {
        ftpWatts: 200,
        intervals: [{ durationSeconds: 3600, powerPercent: 100 }],
      },
    }),
    session("2026-10-22", { intensity: "easy", estimatedTss: 55 }),
    session("2026-10-23", { intensity: "moderate" }),
    session("2026-10-24", {
      type: "rest",
      intensity: "rest",
      status: "rest",
    }),
    session("2026-10-25", {
      type: "rest",
      intensity: "rest",
      status: "rest",
    }),
  ],
};

const plan: CoachPlan = {
  season: {
    goal: "Ride a fast century",
    startDate: "2026-10-19",
    endDate: "2027-04-01",
    rationale: "Build then sharpen.",
    blocks: [
      {
        name: "Base",
        focus: "Aerobic base",
        startDate: "2026-10-19",
        endDate: "2026-12-01",
        weekCount: 6,
      },
    ],
  },
  block: {
    name: "Base",
    focus: "Aerobic base",
    rationale: "Build volume.",
    startDate: "2026-10-19",
    endDate: "2026-12-01",
    weeks: [
      {
        number: 1,
        startDate: "2026-10-19",
        focus: "Base",
        targetLoad: "6 hours",
        estimatedFtpWatts: 255,
      },
      {
        number: 2,
        startDate: "2026-10-26",
        focus: "Build",
        targetLoad: "8 hours",
        estimatedFtpWatts: 260,
      },
    ],
  },
  week,
  today: day("2026-10-20", { status: "completed" }),
  tomorrow: day("2026-10-21"),
  nextWeek: null,
  nextBlock: null,
};

describe("applyTrainingLoad", () => {
  it("scores measured power before the coach's estimate", () => {
    const loaded = applyTrainingLoad(plan, {
      answers: [ftpAnswer],
      activities: [activity()],
    });
    const tuesday = loaded.week.sessions.find(
      (entry) => entry.date === "2026-10-20",
    );

    // 1 h at 200 W against an FTP of 250 W.
    expect(tuesday?.trainingLoad?.tss).toBe(64);
    expect(tuesday?.trainingLoad?.atl).toBe(9.1);
    expect(tuesday?.trainingLoad?.ctl).toBe(1.5);
    expect(tuesday?.trainingLoad?.tsb).toBe(-7.6);
  });

  it("scores planned bike workouts from their intervals", () => {
    const loaded = applyTrainingLoad(plan, {
      answers: [ftpAnswer],
      activities: [activity()],
    });
    const wednesday = loaded.week.sessions.find(
      (entry) => entry.date === "2026-10-21",
    );
    expect(loaded.week.estimatedFtpWatts).toBe(250);
    expect(wednesday?.trainingLoad?.tss).toBe(100);
    // The trainer file must use the same FTP the Week tab shows.
    expect(wednesday?.bikeWorkout?.ftpWatts).toBe(250);
    expect(loaded.tomorrow?.bikeWorkout?.ftpWatts).toBe(250);
  });

  it("uses a manual activity's stored TSS", () => {
    const loaded = applyTrainingLoad(
      {
        ...plan,
        week: {
          ...week,
          sessions: week.sessions.map((entry) =>
            entry.date === "2026-10-20"
              ? { ...entry, description: "Completed: logged manually" }
              : entry,
          ),
        },
      },
      {
        answers: [ftpAnswer],
        activities: [],
        manualActivities: [
          {
            id: 1,
            startDate: "2026-10-20",
            details: "3 hour Zwift race",
            estimatedTss: 120,
          },
        ],
      },
    );
    const tuesday = loaded.week.sessions.find(
      (entry) => entry.date === "2026-10-20",
    );
    expect(tuesday?.trainingLoad?.tss).toBe(120);
    expect(loaded.today.trainingLoad?.tss).toBe(120);
  });

  it("uses the coach's estimate and a duration fallback for other sessions", () => {
    const loaded = applyTrainingLoad(plan, {
      answers: [ftpAnswer],
      activities: [activity()],
    });
    const thursday = loaded.week.sessions.find(
      (entry) => entry.date === "2026-10-22",
    );
    const friday = loaded.week.sessions.find(
      (entry) => entry.date === "2026-10-23",
    );
    expect(thursday?.trainingLoad?.tss).toBe(55);
    expect(friday?.trainingLoad?.tss).toBe(60);
  });

  it("scores a missed session as rest", () => {
    const loaded = applyTrainingLoad(
      {
        ...plan,
        week: {
          ...week,
          sessions: week.sessions.map((entry) =>
            entry.date === "2026-10-23"
              ? { ...entry, status: "missed", estimatedTss: 90 }
              : entry,
          ),
        },
      },
      { answers: [ftpAnswer], activities: [activity()] },
    );
    const friday = loaded.week.sessions.find(
      (entry) => entry.date === "2026-10-23",
    );
    expect(friday?.trainingLoad?.tss).toBe(0);
  });

  it("mirrors the week's load into today and tomorrow", () => {
    const loaded = applyTrainingLoad(plan, {
      answers: [ftpAnswer],
      activities: [activity()],
    });
    expect(loaded.today.trainingLoad?.tss).toBe(64);
    expect(loaded.tomorrow?.trainingLoad?.tss).toBe(100);
  });

  it("scores the next week with its own FTP estimate", () => {
    const nextWeek: WeekPlan = {
      ...week,
      startDate: "2026-10-26",
      estimatedFtpWatts: 260,
      sessions: week.sessions.map((entry, index) => ({
        ...entry,
        date: `2026-10-${String(26 + index)}`,
        status: entry.type === "rest" ? "rest" : "planned",
      })),
    };
    const loaded = applyTrainingLoad(
      {
        ...plan,
        nextWeek,
        tomorrow: day("2026-10-28"),
      },
      { answers: [ftpAnswer], activities: [activity()] },
    );

    expect(loaded.nextWeek?.estimatedFtpWatts).toBe(260);
    expect(loaded.nextWeek?.sessions[2]?.bikeWorkout?.ftpWatts).toBe(260);
    expect(loaded.tomorrow?.trainingLoad?.tss).toBe(100);
  });

  it("keeps the block's week-by-week FTP anchored to the stated FTP", () => {
    const loaded = applyTrainingLoad(plan, {
      answers: [ftpAnswer],
      activities: [activity()],
    });
    expect(loaded.block.weeks[0]?.estimatedFtpWatts).toBe(250);
    expect(loaded.block.weeks[1]?.estimatedFtpWatts).toBe(260);
  });

  it("interpolates the old period and refreshes every level after a test", () => {
    const loaded = applyTrainingLoad(
      {
        ...plan,
        block: {
          ...plan.block,
          weeks: [
            {
              number: 1,
              startDate: "2026-10-12",
              focus: "Base",
              targetLoad: "5 hours",
              estimatedFtpWatts: 250,
            },
            ...plan.block.weeks.map((week) => ({
              ...week,
              number: week.number + 1,
            })),
          ],
        },
      },
      {
        answers: [
          {
            prompt: "FTP?",
            answer: "FTP is 200 W.",
            skipped: false,
            answeredAt: new Date("2026-10-01T10:00:00Z"),
          },
        ],
        activityComments: [
          {
            activityId: "1",
            comment: "FTP test today: 260 W.",
            updatedAt: "2026-10-26T18:00:00Z",
          },
        ],
        activities: [activity()],
      },
    );

    // The current week is refreshed to the new test value.
    expect(loaded.week.estimatedFtpWatts).toBe(260);
    // The earlier block week is interpolated from 200 to 260.
    expect(loaded.block.weeks[0]?.estimatedFtpWatts).toBe(225);
    expect(loaded.block.weeks[1]?.estimatedFtpWatts).toBe(260);
    expect(loaded.block.weeks[2]?.estimatedFtpWatts).toBe(260);
    expect(loaded.block.estimatedFtpWatts).toBe(260);
    expect(loaded.season.estimatedFtpWatts).toBe(260);
    // Tuesday's measured TSS uses the interpolated FTP at its date (245 W).
    expect(loaded.today.trainingLoad?.tss).toBe(67);
  });

  it("updates the estimate when a later comment reports a new FTP test", () => {
    const loaded = applyTrainingLoad(plan, {
      answers: [{ prompt: "FTP?", answer: "Around 240 W.", skipped: false }],
      answersUpdatedAt: new Date("2026-10-01T10:00:00Z"),
      activityComments: [
        {
          activityId: "1",
          comment: "FTP test today: 260 W.",
          updatedAt: "2026-10-20T18:00:00Z",
        },
      ],
      activities: [activity()],
    });
    expect(loaded.week.estimatedFtpWatts).toBe(260);
    expect(loaded.today.trainingLoad?.tss).toBe(59);
  });

  it("turns FTP estimates off when the athlete has never provided one", () => {
    const loaded = applyTrainingLoad(plan, {
      answers: [{ prompt: "Goal?", answer: "Ride a century.", skipped: false }],
      activities: [activity()],
    });
    const tuesday = loaded.week.sessions.find(
      (entry) => entry.date === "2026-10-20",
    );
    expect(loaded.week.estimatedFtpWatts).toBeNull();
    expect(tuesday?.trainingLoad?.tss).toBe(70);
  });

  it("clamps an implausible coach estimate to the stated FTP", () => {
    const loaded = applyTrainingLoad(
      {
        ...plan,
        week: { ...week, estimatedFtpWatts: 900 },
      },
      { answers: [ftpAnswer], activities: [] },
    );
    expect(loaded.week.estimatedFtpWatts).toBe(375);
  });
});
