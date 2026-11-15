import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import { makePlan } from "../testFixtures/generationHarness.js";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
  MemoryPlanStore,
} from "../testFixtures/app.js";
import { expectValidationFailure } from "../testFixtures/validation.js";

describe("coach plan export", () => {
  it("rejects an invalid workout export date", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest("/api/coaching/plan/workouts/not-a-date"),
    );
    await expectValidationFailure(res);
  });

  it("returns 404 when there is no plan to export from", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest("/api/coaching/plan/workouts/2026-10-21"),
    );
    expect(res.status).toBe(404);
  });

  it("returns today's indoor bike workout as a ZWO download", async () => {
    const bikeWorkout = {
      ftpWatts: 220,
      intervals: [
        { durationSeconds: 600, powerPercent: 55 },
        { durationSeconds: 480, powerPercent: 95 },
        { durationSeconds: 300, powerPercent: 45 },
      ],
    };
    const base = makePlan();
    const plan: CoachPlan = {
      ...base,
      today: {
        ...base.today,
        title: "Sweet spot & tempo",
        description: "Indoor trainer ride.",
        outdoor: false,
        canBeOutdoor: false,
        bikeWorkout,
      },
      week: {
        ...base.week,
        sessions: base.week.sessions.map((session) =>
          session.date === "2026-10-21"
            ? { ...session, outdoor: false, bikeWorkout }
            : session,
        ),
      },
    };
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan/workouts/2026-10-21"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="2026-10-21-sweet-spot-tempo.zwo"',
    );
    const body = await res.text();
    expect(body).toContain("<name>Sweet spot &amp; tempo</name>");
    expect(body).toContain("<ftpOverride>220</ftpOverride>");
    expect(body).toContain('<SteadyState Duration="600" Power="0.5500"/>');
    expect(body).toContain("<sportType>bike</sportType>");
  });

  it("exports tomorrow's indoor bike workout", async () => {
    const bikeWorkout = {
      ftpWatts: 220,
      intervals: [{ durationSeconds: 900, powerPercent: 70 }],
    };
    const base = makePlan();
    const plan: CoachPlan = {
      ...base,
      tomorrow: {
        date: "2026-10-22",
        type: "workout",
        title: "Endurance ride",
        description: "Steady trainer ride.",
        durationMinutes: 15,
        intensity: "easy",
        alternatives: [],
        rationale: "Aerobic work.",
        optional: false,
        status: "planned",
        outdoor: false,
        canBeOutdoor: false,
        bikeWorkout,
      },
    };
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan/workouts/2026-10-22"),
    );

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<name>Endurance ride</name>");
    expect(body).toContain('<SteadyState Duration="900" Power="0.7000"/>');
  });

  it("does not export a bike workout planned outdoors", async () => {
    const bikeWorkout = {
      ftpWatts: 220,
      intervals: [{ durationSeconds: 900, powerPercent: 70 }],
    };
    const base = makePlan();
    const planStore = new MemoryPlanStore({
      plan: {
        ...base,
        today: {
          ...base.today,
          outdoor: true,
          bikeWorkout,
        },
      },
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan/workouts/2026-10-21"),
    );

    expect(res.status).toBe(404);
  });
});
