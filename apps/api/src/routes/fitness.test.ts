import { describe, expect, it } from "bun:test";
import type {
  AnalyzedActivitiesResponse,
  AthleteThreshold,
  CoachPlan,
  FitnessHistoryResponse,
} from "@killingit/shared";
import { createApp } from "../index.js";
import type { PlanStore, StoredPlan } from "../plans/store.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import { buildFtpTimelineFromPoints } from "../training/ftp.js";
import { buildThresholdTimelines } from "../training/thresholds.js";
import { buildFitnessHistory } from "../training/history.js";
import type { UserStore } from "../users/store.js";

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
const timeline = buildFtpTimelineFromPoints(thresholdPoints);

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Ride a century.",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-19",
          endDate: "2026-11-29",
          weekCount: 6,
        },
      ],
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
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic",
      rationale: "Keep it easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout",
        title: "Ride",
        description: "Easy spin.",
        durationMinutes: 60,
        intensity: "easy",
        status: "planned",
        estimatedTss: 55,
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
  };
}

class MemoryPlanStore implements PlanStore {
  constructor(public stored: StoredPlan | null) {}

  load(): Promise<StoredPlan | null> {
    return Promise.resolve(this.stored);
  }

  save(): Promise<StoredPlan> {
    throw new Error("not used");
  }
}

const userStore: UserStore = {
  ensureUser: (sub) =>
    Promise.resolve({
      id: 42,
      sub,
      role: "member",
      timezone: null,
      location: null,
      createdAt: new Date(0),
    }),
  getById: (id) =>
    Promise.resolve({
      id,
      sub: "athlete-1",
      role: "member",
      timezone: null,
      location: null,
      createdAt: new Date(0),
    }),
  updateSettings: (sub, settings) =>
    Promise.resolve({
      id: 42,
      sub,
      role: "member",
      timezone: settings.timezone ?? null,
      location: settings.location ?? null,
      createdAt: new Date(0),
    }),
};

const answers: QuestionAnswerStore = {
  listForUser: () => Promise.resolve([]),
  saveAnswers: () => Promise.resolve(true),
};

function makeApp(options: { plan?: CoachPlan | null } = {}) {
  const plan = options.plan === undefined ? makePlan() : options.plan;
  const feed: AnalyzedActivitiesResponse = { model: null, activities: [] };
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore,
    answerStore: answers,
    planStore: new MemoryPlanStore(
      plan === null
        ? null
        : {
            plan,
            answersUpdatedAt: null,
            coachingInputsUpdatedAt: null,
            activitiesUpdatedAt: null,
            generatedAt: new Date(0),
          },
    ),
    loadCachedFeed: () => Promise.resolve(feed),
    // Mirrors the database-backed loader without the account's stored inputs.
    loadFitnessHistory: (
      _userId,
      activities,
      storedPlan,
      today,
      range,
    ): Promise<FitnessHistoryResponse> =>
      Promise.resolve(
        buildFitnessHistory({
          today,
          range,
          activities,
          plan: storedPlan,
          timeline,
          thresholdPoints,
          thresholdTimelines: buildThresholdTimelines(thresholdPoints),
          planTssByDate: new Map(
            (storedPlan?.week.sessions ?? []).map((session) => [
              session.date,
              session.estimatedTss ?? 0,
            ]),
          ),
          manualTssByDate: new Map(),
        }),
      ),
  });
}

function authenticatedRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer anything" },
  });
}

describe("fitness route", () => {
  it("requires a bearer token", async () => {
    const res = await makeApp().fetch(
      new Request("http://localhost/api/fitness?today=2026-10-22"),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a missing today date", async () => {
    const res = await makeApp().fetch(authenticatedRequest("/api/fitness"));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown range", async () => {
    const res = await makeApp().fetch(
      authenticatedRequest("/api/fitness?today=2026-10-22&range=decade"),
    );
    expect(res.status).toBe(400);
  });

  it("returns the daily load and FTP series", async () => {
    const res = await makeApp().fetch(
      authenticatedRequest("/api/fitness?today=2026-10-22&range=week"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as FitnessHistoryResponse;
    // A week back, plus the planned days of the stored week.
    expect(body.days).toHaveLength(10);
    expect(body.days[0]?.date).toBe("2026-10-16");
    expect(body.days.at(-1)?.date).toBe("2026-10-25");
    expect(body.days.at(-1)?.planned).toEqual({
      title: "Ride",
      type: "workout",
      durationMinutes: 60,
    });
    expect(body.thresholds[0]?.points.at(-1)).toEqual({
      date: "2026-10-25",
      value: 255,
    });
  });

  it("answers for the wider ranges", async () => {
    const res = await makeApp({ plan: null }).fetch(
      authenticatedRequest("/api/fitness?today=2026-10-22&range=year"),
    );

    const body = (await res.json()) as FitnessHistoryResponse;
    expect(body.days).toHaveLength(365);
    expect(body.days[0]?.date).toBe("2025-10-23");
  });

  it("still answers without a stored plan", async () => {
    const res = await makeApp({ plan: null }).fetch(
      authenticatedRequest("/api/fitness?today=2026-10-22&range=week"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as FitnessHistoryResponse;
    expect(body.days).toHaveLength(7);
    expect(body.thresholds[0]?.points.at(-1)).toEqual({
      date: "2026-10-22",
      value: 250,
    });
  });
});
