import { describe, expect, it } from "bun:test";
import type { AthleteEvent, AthleteLocation } from "@killingit/shared";
import {
  makePlan,
  weekForecast,
  withWeather,
} from "../testFixtures/generationHarness.js";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
  MemoryPlanStore,
} from "../testFixtures/app.js";
import { forecastSet } from "../testFixtures/planRoute.js";
import { apiRequest } from "../testFixtures/request.js";
import { expectValidationFailure } from "../testFixtures/validation.js";

describe("coach plan route", () => {
  it("requires a bearer token", async () => {
    const res = await makeApp({}).fetch(
      apiRequest("http://localhost/api/coaching/plan?today=2026-10-21"),
    );
    expect(res.status).toBe(401);
  });

  it("reports an empty plan and pending levels", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: unknown;
      pending: { initial: boolean };
      generation: { status: string };
    };
    expect(body.plan).toBeNull();
    expect(body.pending.initial).toBe(true);
    expect(body.generation.status).toBe("idle");
  });

  it("returns the athlete's dated goals and events", async () => {
    const res = await makeApp({
      events: [
        {
          startDate: "2027-03-14",
          endDate: null,
          title: "Oslo Marathon",
          kind: "race",
        },
      ],
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: AthleteEvent[] };
    expect(body.events).toEqual([
      {
        startDate: "2027-03-14",
        endDate: null,
        title: "Oslo Marathon",
        kind: "race",
      },
    ]);
  });

  it("rejects a missing today date", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest("/api/coaching/plan"),
    );
    await expectValidationFailure(res);
  });

  it("rejects an includeTomorrow that is not true or false", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest(
        "/api/coaching/plan?today=2026-10-21&includeTomorrow=yes",
      ),
    );
    await expectValidationFailure(res);
  });

  it("accepts the explicit includeTomorrow the dashboard sends", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest(
        "/api/coaching/plan?today=2026-10-21&includeTomorrow=false",
      ),
    );

    expect(res.status).toBe(200);
  });

  it("returns a stored plan that covers today", async () => {
    const plan = makePlan();
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: {
        initial: boolean;
        day: boolean;
        week: boolean;
        block: boolean;
        tomorrow: boolean;
        nextWeek: boolean;
        nextBlock: boolean;
        dietProgress: boolean;
      };
      stale: boolean;
    };
    expect(body.pending).toEqual({
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    });
    expect(body.stale).toBe(false);
  });

  it("marks the week pending when the forecast changes significantly", async () => {
    const location: AthleteLocation = {
      latitude: 59.91,
      longitude: 10.75,
      name: "Oslo",
    };
    const previous = weekForecast("sun");
    const planStore = new MemoryPlanStore({
      plan: withWeather(makePlan(), previous),
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });
    const changed = weekForecast("sun");
    const friday = changed[4];
    if (friday === undefined) {
      throw new Error("missing test forecast day");
    }
    changed[4] = { ...friday, icon: "rain", precipitationMm: 4 };

    const res = await makeApp({
      planStore,
      location,
      loadForecast: () => Promise.resolve(forecastSet(changed)),
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: { week: boolean } };
    expect(body.pending.week).toBe(true);
  });

  it("does not mark the week pending for a small forecast change", async () => {
    const location: AthleteLocation = {
      latitude: 59.91,
      longitude: 10.75,
      name: "Oslo",
    };
    const previous = weekForecast("sun");
    const planStore = new MemoryPlanStore({
      plan: withWeather(makePlan(), previous),
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({
      planStore,
      location,
      loadForecast: () =>
        Promise.resolve(forecastSet(weekForecast("partly_cloudy"))),
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: { week: boolean } };
    expect(body.pending.week).toBe(false);
  });

  it("does not fail when the forecast cannot be fetched", async () => {
    const location: AthleteLocation = {
      latitude: 59.91,
      longitude: 10.75,
      name: "Oslo",
    };
    const planStore = new MemoryPlanStore({
      plan: withWeather(makePlan(), weekForecast("sun")),
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({
      planStore,
      location,
      loadForecast: () => Promise.reject(new Error("weather down")),
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: { week: boolean } };
    expect(body.pending.week).toBe(false);
  });

  it("treats a completed day that is still planned on the week as pending", async () => {
    const plan = makePlan();
    plan.today = {
      ...plan.today,
      title: "Completed morning run",
      description: "Completed: running · 10.00 km · 50 min",
      durationMinutes: 50,
      status: "completed",
    };
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: { week: boolean; day: boolean };
    };
    expect(body.pending.day).toBe(false);
    expect(body.pending.week).toBe(true);
  });

  it("shows a stored next week as current once today has reached it", async () => {
    const plan = makePlan("2026-10-25");
    plan.week = {
      ...plan.week,
      startDate: "2026-10-19",
      sessions: plan.week.sessions.map((session, index) => ({
        ...session,
        date: `2026-10-${String(19 + index)}`,
      })),
    };
    plan.tomorrow = {
      ...plan.today,
      date: "2026-10-26",
      title: "Monday easy run",
    };
    plan.nextWeek = {
      ...plan.week,
      startDate: "2026-10-26",
      sessions: plan.week.sessions.map((session, index) => ({
        ...session,
        date:
          [
            "2026-10-26",
            "2026-10-27",
            "2026-10-28",
            "2026-10-29",
            "2026-10-30",
            "2026-10-31",
            "2026-11-01",
          ][index] ?? session.date,
      })),
    };
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-21T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-25T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-26"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: {
        week: { startDate: string };
        today: { date: string; title: string };
        tomorrow: unknown;
        nextWeek: unknown;
      };
      pending: { week: boolean; day: boolean };
    };
    expect(body.plan.week.startDate).toBe("2026-10-26");
    expect(body.plan.today.date).toBe("2026-10-26");
    expect(body.plan.today.title).toBe("Monday easy run");
    expect(body.plan.tomorrow).toBeNull();
    expect(body.plan.nextWeek).toBeNull();
    // The stored plan still needs advancing so the promotion is persisted.
    expect(body.pending.week).toBe(true);
    expect(body.pending.day).toBe(true);
  });

  it("reports when tomorrow has crossed into a new week and block", async () => {
    const plan = makePlan("2026-10-25");
    plan.block = { ...plan.block, endDate: "2026-10-25" };
    plan.week = {
      ...plan.week,
      startDate: "2026-10-19",
      sessions: plan.week.sessions.map((session, index) => ({
        ...session,
        date: `2026-10-${String(19 + index)}`,
      })),
    };
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-21T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-25T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest(
        "/api/coaching/plan?today=2026-10-25&includeTomorrow=true",
      ),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: {
        tomorrow: boolean;
        nextWeek: boolean;
        nextBlock: boolean;
      };
    };
    expect(body.pending.tomorrow).toBe(true);
    expect(body.pending.nextWeek).toBe(true);
    expect(body.pending.nextBlock).toBe(true);
  });

  it("marks the plan stale when a coaching input is newer than the plan", async () => {
    const plan = makePlan();
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({
      planStore,
      coachingInputs: {
        manualActivities: [],
        activityComments: [],
        weeklyNote: "I cannot train on Friday this week.",
        weeklyNoteWeekStartDate: "2026-10-19",
        weeklyNoteReply: "Understood; Friday is a rest day.",
        weeklyNoteUpdatedAt: new Date("2026-10-21T08:00:00Z"),
        periodReviews: [],
        weekReviewUpdatedAt: null,
        weekReviewNeedsRefresh: false,
        blockReviewUpdatedAt: null,
        blockReviewNeedsRefresh: false,
        updatedAt: new Date("2026-10-21T08:00:00Z"),
        refreshUpdatedAt: new Date("2026-10-21T08:00:00Z"),
      },
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { stale: boolean };
    expect(body.stale).toBe(true);
  });

  it("does not mark the plan stale for a newer input that needs no change", async () => {
    const plan = makePlan();
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({
      planStore,
      coachingInputs: {
        manualActivities: [],
        activityComments: [],
        weeklyNote: "Thanks, the week felt good.",
        weeklyNoteWeekStartDate: "2026-10-19",
        weeklyNoteReply: "Good week; nothing to change.",
        weeklyNoteUpdatedAt: new Date("2026-10-21T08:00:00Z"),
        periodReviews: [],
        weekReviewUpdatedAt: null,
        weekReviewNeedsRefresh: false,
        blockReviewUpdatedAt: null,
        blockReviewNeedsRefresh: false,
        updatedAt: new Date("2026-10-21T08:00:00Z"),
        refreshUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      },
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { stale: boolean };
    expect(body.stale).toBe(false);
  });

  it("does not mark the block pending when there is no week review", async () => {
    const plan = makePlan();
    // The athlete has coaching inputs, but the stored plan already includes
    // them and no week review has been generated. A missing review must not
    // look like a newer review, or the dashboard regenerates forever.
    const coachingInputsUpdatedAt = new Date("2026-10-20T10:00:00Z");
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({
      planStore,
      coachingInputs: {
        manualActivities: [],
        activityComments: [],
        weeklyNote: "I cannot train on Friday this week.",
        weeklyNoteWeekStartDate: "2026-10-19",
        weeklyNoteReply: "Understood; Friday is a rest day.",
        weeklyNoteUpdatedAt: new Date("2026-10-20T10:00:00Z"),
        periodReviews: [],
        weekReviewUpdatedAt: null,
        weekReviewNeedsRefresh: false,
        blockReviewUpdatedAt: null,
        blockReviewNeedsRefresh: false,
        updatedAt: coachingInputsUpdatedAt,
        refreshUpdatedAt: coachingInputsUpdatedAt,
      },
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stale: boolean;
      pending: { block: boolean };
    };
    expect(body.stale).toBe(false);
    expect(body.pending.block).toBe(false);
  });

  it("does not mark the block pending for a review comment that needs no change", async () => {
    const plan = makePlan();
    const storedAt = new Date("2026-10-20T10:00:00Z");
    const reviewedAt = new Date("2026-10-21T08:00:00Z");
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: storedAt,
      coachingInputsUpdatedAt: storedAt,
      activitiesUpdatedAt: null,
      generatedAt: storedAt,
    });

    const res = await makeApp({
      planStore,
      coachingInputs: {
        manualActivities: [],
        activityComments: [],
        weeklyNote: null,
        weeklyNoteWeekStartDate: null,
        weeklyNoteReply: null,
        weeklyNoteUpdatedAt: null,
        periodReviews: [],
        weekReviewUpdatedAt: reviewedAt,
        weekReviewNeedsRefresh: false,
        blockReviewUpdatedAt: null,
        blockReviewNeedsRefresh: false,
        updatedAt: reviewedAt,
        refreshUpdatedAt: storedAt,
      },
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stale: boolean;
      pending: { block: boolean };
    };
    expect(body.stale).toBe(false);
    expect(body.pending.block).toBe(false);
  });

  it("treats an invalid stored plan as absent instead of failing", async () => {
    const invalidPlan = makePlan();
    // Simulate a plan saved under an older schema that predates `rationale`.
    delete (invalidPlan.week as unknown as Record<string, unknown>).rationale;
    const planStore = new MemoryPlanStore({
      plan: invalidPlan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: unknown;
      pending: { initial: boolean };
    };
    expect(body.plan).toBeNull();
    expect(body.pending.initial).toBe(true);
  });
});
