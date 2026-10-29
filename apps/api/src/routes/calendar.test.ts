import { describe, expect, it } from "bun:test";
import type {
  AnalyzedActivitiesResponse,
  CalendarResponse,
  CoachPlan,
} from "@killingit/shared";
import { createApp } from "../index.js";
import type { ManualActivityContext } from "../llm/planContext.js";
import type { StoredCoachReply } from "../plans/replies.js";
import type { PlanStore, StoredPlan } from "../plans/store.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Ride a century.",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-01",
          endDate: "2026-12-01",
          weekCount: 8,
        },
        {
          name: "Build",
          focus: "Threshold",
          startDate: "2026-12-01",
          endDate: "2026-12-31",
          weekCount: 4,
        },
      ],
      rationale: "Build endurance.",
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      startDate: "2026-10-01",
      endDate: "2026-12-01",
      rationale: "Build the base.",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
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
        type: index === 6 ? ("rest" as const) : ("workout" as const),
        title: index === 6 ? "Rest" : `Ride ${index + 1}`,
        description: index === 6 ? "Take the day off." : "Easy spin.",
        durationMinutes: index === 6 ? 0 : 60,
        intensity: index === 6 ? ("rest" as const) : ("easy" as const),
        status: index === 1 ? ("completed" as const) : ("planned" as const),
        estimatedTss: index === 6 ? undefined : 55,
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
    nextWeek: {
      startDate: "2026-10-26",
      focus: "Aerobic",
      rationale: "Keep it easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(26 + index)}`,
        day: "Monday",
        type: "workout" as const,
        title: `Next ride ${index + 1}`,
        description: "Easy spin.",
        durationMinutes: 60,
        intensity: "easy" as const,
        status: "planned" as const,
        estimatedTss: 55,
      })),
    },
    nextBlock: null,
  };
}

const activity = {
  id: 123,
  name: "Morning ride",
  type: "cycling",
  startDate: "2026-10-20T07:00:00.000Z",
  distance: 25000,
  movingTime: 3600,
  elapsedTime: 3900,
  totalElevationGain: 300,
  sampleCount: 10,
  samples: [],
  route: [
    { latitude: 59.9, longitude: 10.7 },
    { latitude: 59.92, longitude: 10.72 },
  ],
  analysis: {
    text: "A steady aerobic ride.",
    model: "test/model",
    generatedAt: "2026-10-20T08:00:00.000Z",
  },
  analysisError: null,
  programAnalysis: null,
  comment: "Felt good.",
  coachReply: {
    text: "Nice work.",
    model: "test/model",
    generatedAt: "2026-10-20T08:05:00.000Z",
  },
  reviewed: false,
  trainingLoad: {
    tss: 50,
    atl: 40,
    ctl: 45,
    tsb: 5,
  },
};

const feed: AnalyzedActivitiesResponse = {
  model: null,
  activities: [activity],
};

const manualActivities: ManualActivityContext[] = [
  {
    id: 7,
    startDate: "2026-10-05",
    details: "Club ride",
    estimatedTss: 80,
    updatedAt: "2026-10-05T12:00:00.000Z",
  },
];

const manualReplies = new Map<number, StoredCoachReply>([
  [
    7,
    {
      kind: "manual_activity",
      target: "7",
      text: "Good session.",
      model: "test/model",
      generatedAt: new Date("2026-10-05T13:00:00Z"),
    },
  ],
]);

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

function makeApp(): ReturnType<typeof createApp> {
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore,
    answerStore: answers,
    planStore: new MemoryPlanStore({
      plan: makePlan(),
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date(0),
    }),
    loadCachedFeed: () => Promise.resolve(feed),
    loadManualActivities: () => Promise.resolve(manualActivities),
    loadManualActivityReplies: () => Promise.resolve(manualReplies),
  });
}

function authenticatedRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer anything" },
  });
}

describe("calendar route", () => {
  it("requires a bearer token", async () => {
    const res = await makeApp().fetch(
      new Request("http://localhost/api/calendar?today=2026-10-22"),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a missing today date", async () => {
    const res = await makeApp().fetch(authenticatedRequest("/api/calendar"));
    expect(res.status).toBe(400);
  });

  it("returns activities, plan sessions, block starts, and the season end", async () => {
    const res = await makeApp().fetch(
      authenticatedRequest("/api/calendar?today=2026-10-22"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as CalendarResponse;
    // The season starts before the first recorded activity, so its start date
    // and block starts remain reachable.
    expect(body.earliestDate).toBe("2026-10-01");
    expect(body.latestDate).toBe("2026-12-31");
    expect(body.season?.endDate).toBe("2026-12-31");

    const days = new Map(body.days.map((day) => [day.date, day]));
    expect(days.get("2026-10-01")?.blockStart?.name).toBe("Base");
    expect(days.get("2026-12-01")?.blockStart?.name).toBe("Build");
    expect(days.get("2026-12-31")?.seasonEnd).toBe(true);

    const manual = days.get("2026-10-05")?.activities[0];
    expect(manual?.source).toBe("manual");
    expect(manual?.name).toBe("Club ride");
    if (manual?.source === "manual") {
      expect(manual.estimatedTss).toBe(80);
      expect(manual.coachReply?.text).toBe("Good session.");
    }

    const recorded = days.get("2026-10-20");
    expect(recorded?.session?.status).toBe("completed");
    expect(recorded?.activities[0]?.source).toBe("garmin");
    expect(recorded?.activities[0]?.name).toBe("Morning ride");
    if (recorded?.activities[0]?.source === "garmin") {
      expect(recorded.activities[0].comment).toBe("Felt good.");
      expect(recorded.activities[0].coachReply?.text).toBe("Nice work.");
      expect(recorded.activities[0].route).toHaveLength(2);
    }

    expect(days.get("2026-10-25")?.session?.type).toBe("rest");
    expect(days.get("2026-10-27")?.session?.title).toBe("Next ride 2");
  });
});
