import { describe, expect, it } from "bun:test";
import type {
  AnalyzedActivitiesResponse,
  AthleteEvent,
  CalendarResponse,
  CoachPlan,
} from "@killingit/shared";
import { createApp } from "../index.js";
import type { ManualActivityContext } from "../llm/activityContext.js";
import type { StoredCoachReply } from "../plans/replies.js";
import type { PlanStore, StoredPlan } from "../plans/store.js";
import type { WeekPlanTotals } from "../plans/weekTotals.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import {
  makeBlock,
  makeDay,
  makePlan as makeFixturePlan,
  makeSeason,
  makeWeek,
} from "../testFixtures/plan.js";
import type { UserStore } from "../users/store.js";
import { buildCalendar } from "./calendar.js";
import { apiRequest } from "../testFixtures/request.js";

function makePlan(): CoachPlan {
  const week = makeWeek("2026-10-19");
  const nextWeek = makeWeek("2026-10-26");
  return makeFixturePlan({
    season: makeSeason({
      goal: "Ride a century.",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      rationale: "Build endurance.",
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
    }),
    block: makeBlock({
      startDate: "2026-10-01",
      rationale: "Build the base.",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
        },
      ],
    }),
    week: {
      ...week,
      focus: "Aerobic",
      rationale: "Keep it easy.",
      sessions: week.sessions.map((session, index) => ({
        ...session,
        type: index === 6 ? ("rest" as const) : ("workout" as const),
        title: index === 6 ? "Rest" : `Ride ${index + 1}`,
        description: index === 6 ? "Take the day off." : "Easy spin.",
        durationMinutes: index === 6 ? 0 : 60,
        intensity: index === 6 ? ("rest" as const) : ("easy" as const),
        status: index === 1 ? ("completed" as const) : ("planned" as const),
        ...(index === 6 ? {} : { estimatedTss: 55 }),
      })),
    },
    today: makeDay("2026-10-22", {
      title: "Ride",
      description: "Easy spin.",
      durationMinutes: 60,
    }),
    nextWeek: {
      ...nextWeek,
      focus: "Aerobic",
      rationale: "Keep it easy.",
      sessions: nextWeek.sessions.map((session, index) => ({
        ...session,
        title: `Next ride ${index + 1}`,
        description: "Easy spin.",
        durationMinutes: 60,
        estimatedTss: 55,
      })),
    },
  });
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
      planChangeNeeded: true,
    },
  ],
]);

const events: AthleteEvent[] = [
  {
    startDate: "2026-10-20",
    endDate: null,
    title: "City half marathon",
    kind: "race",
  },
  {
    startDate: "2026-10-30",
    endDate: "2026-11-02",
    title: "Training camp",
    kind: "trip",
  },
];

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
      dietAdvice: false,
      createdAt: new Date(0),
    }),
  getById: (id) =>
    Promise.resolve({
      id,
      sub: "athlete-1",
      role: "member",
      timezone: null,
      location: null,
      dietAdvice: false,
      createdAt: new Date(0),
    }),
  deleteUser: () => Promise.resolve(),
  updateSettings: (sub, settings) =>
    Promise.resolve({
      id: 42,
      sub,
      role: "member",
      timezone: settings.timezone ?? null,
      location: settings.location ?? null,
      dietAdvice: false,
      createdAt: new Date(0),
    }),
};

const answers: QuestionAnswerStore = {
  listForUser: () => Promise.resolve([]),
  saveAnswers: () => Promise.resolve(true),
};

function makeApp(
  options: { weekTotals?: Map<string, WeekPlanTotals> } = {},
): ReturnType<typeof createApp> {
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
    loadEvents: () => Promise.resolve(events),
    loadWeekTotals: () => Promise.resolve(options.weekTotals ?? new Map()),
  });
}

function authenticatedRequest(path: string): Request {
  return apiRequest(`http://localhost${path}`, {
    headers: { authorization: "Bearer anything" },
  });
}

describe("calendar route", () => {
  it("requires a bearer token", async () => {
    const res = await makeApp().fetch(
      apiRequest("http://localhost/api/calendar?today=2026-10-22"),
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
    const weeks = new Map(body.weeks.map((week) => [week.startDate, week]));
    expect(weeks.get("2026-09-28")?.blockName).toBe("Base");
    expect(weeks.get("2026-10-19")?.focus).toBe("Aerobic");
    expect(weeks.get("2026-10-19")?.targetLoad).toBe("Easy");
    expect(weeks.get("2026-10-26")?.focus).toBe("Aerobic");
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

  it("shows a dated goal or event on every day it covers", async () => {
    const res = await makeApp().fetch(
      authenticatedRequest("/api/calendar?today=2026-10-22"),
    );

    const body = (await res.json()) as CalendarResponse;
    const days = new Map(body.days.map((day) => [day.date, day]));
    expect(
      days.get("2026-10-20")?.events.map((event) => event.title),
    ).toContain("City half marathon");
    expect(
      days.get("2026-10-30")?.events.map((event) => event.title),
    ).toContain("Training camp");
    expect(
      days.get("2026-11-01")?.events.map((event) => event.title),
    ).toContain("Training camp");
    expect(days.get("2026-11-03")?.events ?? []).toHaveLength(0);
  });

  it("totals planned and completed time and TSS for each week", async () => {
    const res = await makeApp().fetch(
      authenticatedRequest("/api/calendar?today=2026-10-22"),
    );

    const body = (await res.json()) as CalendarResponse;
    const weeks = new Map(body.weeks.map((week) => [week.startDate, week]));
    const planned = weeks.get("2026-10-19");
    expect(planned?.stats.plannedMinutes).toBe(360);
    expect(planned?.stats.plannedTss).toBe(330);
    expect(planned?.stats.completedMinutes).toBe(65);
    expect(planned?.stats.completedTss).toBe(50);
    // A manual entry has an estimated TSS but no duration.
    const manual = weeks.get("2026-10-05");
    expect(manual?.stats.completedMinutes).toBe(0);
    expect(manual?.stats.completedTss).toBe(80);
  });

  it("keeps a previous week's planned totals after the plan moved on", async () => {
    const res = await makeApp({
      weekTotals: new Map([
        ["2026-10-12", { plannedMinutes: 300, plannedTss: 280 }],
        // A stale stored value must not override the live plan's week.
        ["2026-10-19", { plannedMinutes: 1, plannedTss: 1 }],
      ]),
    }).fetch(authenticatedRequest("/api/calendar?today=2026-10-22"));

    const body = (await res.json()) as CalendarResponse;
    const weeks = new Map(body.weeks.map((week) => [week.startDate, week]));
    expect(weeks.get("2026-10-12")?.stats.plannedMinutes).toBe(300);
    expect(weeks.get("2026-10-12")?.stats.plannedTss).toBe(280);
    expect(weeks.get("2026-10-19")?.stats.plannedMinutes).toBe(360);
    expect(weeks.get("2026-10-19")?.stats.plannedTss).toBe(330);
  });

  it("extends the calendar range to a date the athlete mentioned", () => {
    const body = buildCalendar({
      today: "2026-10-22",
      timeZone: null,
      plan: makePlan(),
      feed,
      manualActivities: [],
      manualReplies: new Map(),
      events: [
        {
          startDate: "2027-02-14",
          endDate: null,
          title: "Spring marathon",
          kind: "race",
        },
      ],
    });

    expect(body.latestDate).toBe("2027-02-14");
    const day = body.days.find((entry) => entry.date === "2027-02-14");
    expect(day?.events[0]?.title).toBe("Spring marathon");
  });

  it("shows an activity on the athlete's local day", () => {
    // 06:30 UTC on 21 October is 23:30 on 20 October in Los Angeles (PDT).
    const evening = {
      ...activity,
      id: 124,
      startDate: "2026-10-21T06:30:00.000Z",
    };

    const local = buildCalendar({
      today: "2026-10-22",
      timeZone: "America/Los_Angeles",
      plan: makePlan(),
      feed: { model: null, activities: [evening] },
      manualActivities: [],
      manualReplies: new Map(),
    });

    expect(
      local.days.find((entry) => entry.date === "2026-10-20")?.activities,
    ).toHaveLength(1);
    expect(
      local.days.find((entry) => entry.date === "2026-10-21")?.activities,
    ).toHaveLength(0);

    const utc = buildCalendar({
      today: "2026-10-22",
      timeZone: "UTC",
      plan: makePlan(),
      feed: { model: null, activities: [evening] },
      manualActivities: [],
      manualReplies: new Map(),
    });
    expect(
      utc.days.find((entry) => entry.date === "2026-10-20")?.activities,
    ).toHaveLength(0);
    expect(
      utc.days.find((entry) => entry.date === "2026-10-21")?.activities,
    ).toHaveLength(1);
  });

  it("accepts the athlete's time zone as a query parameter", async () => {
    const res = await makeApp().fetch(
      authenticatedRequest(
        "/api/calendar?today=2026-10-22&timezone=America%2FLos_Angeles",
      ),
    );

    expect(res.status).toBe(200);
  });

  it("numbers each week inside its season block", async () => {
    const res = await makeApp().fetch(
      authenticatedRequest("/api/calendar?today=2026-10-22"),
    );

    const body = (await res.json()) as CalendarResponse;
    const weeks = new Map(body.weeks.map((week) => [week.startDate, week]));
    // The season block numbers every week it covers, so a week the coach has not
    // detailed yet still says where it falls and carries no other description.
    expect(weeks.get("2026-10-12")?.weekNumber).toBe(3);
    expect(weeks.get("2026-11-02")?.blockName).toBe("Base");
    expect(weeks.get("2026-11-02")?.weekNumber).toBe(6);
    expect(weeks.get("2026-11-02")?.focus).toBeNull();
    // The block plan's number is the one the Block tab shows, so it wins.
    expect(weeks.get("2026-10-19")?.weekNumber).toBe(1);
    // A later block starts its numbering again.
    expect(weeks.get("2026-12-07")?.blockName).toBe("Build");
    expect(weeks.get("2026-12-07")?.weekNumber).toBe(2);
  });
});
