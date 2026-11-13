import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, WeekPlan } from "@killingit/shared";
import {
  makeAnalyzedActivity,
  makeDay,
  makeWeek as makeFixtureWeek,
  PLAN_TODAY,
} from "../testFixtures/plan.js";
import { applyCompletedDays } from "./week.js";

function makeWeek(): WeekPlan {
  const week = makeFixtureWeek();
  return {
    ...week,
    sessions: week.sessions.map((session, index) =>
      index === 6
        ? { ...session, type: "rest", intensity: "rest", status: "rest" }
        : session,
    ),
  };
}

function makeActivity(
  overrides: Partial<AnalyzedActivity> = {},
): AnalyzedActivity {
  return makeAnalyzedActivity({
    name: "Morning Run",
    type: "running",
    startDate: "2026-10-19T06:30:00Z",
    distance: 10000,
    movingTime: 2700,
    elapsedTime: 2800,
    totalElevationGain: 80,
    sampleCount: 100,
    ...overrides,
  });
}

describe("applyCompletedDays", () => {
  it("keeps the planned outline on a completed past day", () => {
    const week = applyCompletedDays(
      makeWeek(),
      [makeActivity()],
      "2026-10-21",
      null,
    );

    expect(week.rationale).toBe("Keep the week easy.");

    const monday = week.sessions[0];
    expect(monday?.status).toBe("completed");
    expect(monday?.title).toBe("Session 1");
    expect(monday?.description).toBe("Easy aerobic work.");
    expect(monday?.durationMinutes).toBe(45);

    const tuesday = week.sessions[1];
    expect(tuesday?.status).toBe("missed");
    expect(tuesday?.title).toBe("Session 2");
    expect(tuesday?.description).toBe("Easy aerobic work.");
    expect(tuesday?.durationMinutes).toBe(45);
  });

  it("keeps a past day's outline when several activities were recorded", () => {
    const activities = [
      makeActivity({
        id: 1,
        name: "Indoor Rowing",
        type: "rowing",
        startDate: "2026-10-19T06:30:00Z",
        distance: 0,
        elapsedTime: 15 * 60,
        movingTime: 15 * 60,
      }),
      makeActivity({
        id: 2,
        name: "Easy Run",
        startDate: "2026-10-19T18:30:00Z",
        distance: 5000,
        elapsedTime: 32 * 60,
        movingTime: 32 * 60,
      }),
    ];

    const applied = applyCompletedDays(
      makeWeek(),
      activities,
      "2026-10-21",
      null,
    );
    const monday = applied.sessions[0];
    expect(monday?.status).toBe("completed");
    expect(monday?.title).toBe("Session 1");
    expect(monday?.description).toBe("Easy aerobic work.");
  });

  it("keeps today and future days planned", () => {
    const week = applyCompletedDays(makeWeek(), [], "2026-10-21", null);

    expect(week.sessions[2]?.status).toBe("planned");
    expect(week.sessions[2]?.title).toBe("Session 3");
    expect(week.sessions[3]?.status).toBe("planned");
    expect(week.sessions[6]?.status).toBe("rest");
  });

  it("keeps the outline for a manual activity", () => {
    const week = applyCompletedDays(makeWeek(), [], "2026-10-21", null, [
      {
        id: 5,
        startDate: "2026-10-19",
        details: "Strength session at the gym",
      },
    ]);

    const monday = week.sessions[0];
    expect(monday?.status).toBe("completed");
    expect(monday?.title).toBe("Session 1");
    expect(monday?.description).toBe("Easy aerobic work.");
    expect(monday?.durationMinutes).toBe(45);
  });

  it("keeps today's outline and settles its status with slack", () => {
    const week = makeWeek();
    // The session plans 45 minutes; 40 minutes is within the slack.
    const activity = makeActivity({
      startDate: "2026-10-21T06:30:00Z",
      elapsedTime: 40 * 60,
      movingTime: 40 * 60,
      name: "Lunch Ride",
    });

    const applied = applyCompletedDays(week, [activity], "2026-10-21", null);
    const today = applied.sessions[2];

    expect(today?.status).toBe("completed");
    expect(today?.title).toBe("Session 3");
    expect(today?.description).toBe("Easy aerobic work.");
    expect(today?.durationMinutes).toBe(45);
  });

  it("marks today's workout as partial when it was much shorter", () => {
    const activity = makeActivity({
      startDate: "2026-10-21T06:30:00Z",
      elapsedTime: 15 * 60,
      movingTime: 15 * 60,
    });

    const applied = applyCompletedDays(
      makeWeek(),
      [activity],
      "2026-10-21",
      null,
    );
    expect(applied.sessions[2]?.status).toBe("partial");
  });

  it("counts several activities on one day together", () => {
    const week = makeWeek();
    const planned: WeekPlan = {
      ...week,
      sessions: week.sessions.map((session, index) =>
        index === 2 ? { ...session, durationMinutes: 60 } : session,
      ),
    };
    const activities = [
      makeActivity({
        id: 1,
        name: "Indoor Rowing",
        type: "rowing",
        startDate: "2026-10-21T06:30:00Z",
        distance: 0,
        elapsedTime: 20 * 60,
        movingTime: 20 * 60,
      }),
      makeActivity({
        id: 2,
        name: "Easy Run",
        startDate: "2026-10-21T17:30:00Z",
        distance: 5000,
        elapsedTime: 40 * 60,
        movingTime: 40 * 60,
      }),
    ];

    const applied = applyCompletedDays(planned, activities, "2026-10-21", null);
    expect(applied.sessions[2]?.status).toBe("completed");
    expect(applied.sessions[2]?.description).toBe("Easy aerobic work.");
  });

  it("keeps the coach's partial verdict for a past day", () => {
    const week = makeWeek();
    const partialWeek: WeekPlan = {
      ...week,
      sessions: week.sessions.map((session, index) =>
        index === 0 ? { ...session, status: "partial" } : session,
      ),
    };

    const applied = applyCompletedDays(
      partialWeek,
      [makeActivity()],
      "2026-10-21",
      null,
    );
    expect(applied.sessions[0]?.status).toBe("partial");
  });

  it("keeps today planned when the day plan says completed but nothing was recorded", () => {
    // Today cannot be completed without a recorded activity, whatever a stored
    // verdict claims, so the day and the week follow the same rule.
    const applied = applyCompletedDays(makeWeek(), [], "2026-10-21", null, [], {
      ...makeDay(PLAN_TODAY, { status: "completed" }),
    });

    const today = applied.sessions[2];
    expect(today?.status).toBe("planned");
    expect(today?.title).toBe("Session 3");
    expect(today?.description).toBe("Easy aerobic work.");
  });

  it("settles today from a manual activity like any other recorded effort", () => {
    const applied = applyCompletedDays(makeWeek(), [], "2026-10-21", null, [
      { id: 6, startDate: "2026-10-21", details: "Gym session" },
    ]);

    const today = applied.sessions[2];
    expect(today?.status).toBe("completed");
    expect(today?.title).toBe("Session 3");
    expect(today?.description).toBe("Easy aerobic work.");
  });

  it("shows a brief activity record when a rest day was used for training", () => {
    const week = makeWeek();
    const restWeek: WeekPlan = {
      ...week,
      sessions: week.sessions.map((session, index) =>
        index === 0 || index === 2
          ? { ...session, type: "rest", intensity: "rest" }
          : session,
      ),
    };

    const applied = applyCompletedDays(
      restWeek,
      [
        makeActivity(),
        makeActivity({ id: 2, startDate: "2026-10-21T06:30:00Z" }),
      ],
      "2026-10-21",
      null,
    );

    const past = applied.sessions[0];
    expect(past?.status).toBe("completed");
    expect(past?.type).toBe("workout");
    expect(past?.title).toBe("Morning Run");
    expect(past?.description).toContain("Completed: Running");

    const today = applied.sessions[2];
    expect(today?.status).toBe("completed");
    expect(today?.type).toBe("workout");
    expect(today?.title).toBe("Morning Run");
    expect(today?.description).toContain("Completed: Running");
  });

  it("keeps a past rest day without activity as rest", () => {
    const week = makeWeek();
    const restWeek: WeekPlan = {
      ...week,
      sessions: week.sessions.map((session, index) =>
        index === 0 ? { ...session, type: "rest", intensity: "rest" } : session,
      ),
    };

    const applied = applyCompletedDays(restWeek, [], "2026-10-21", null);
    expect(applied.sessions[0]?.status).toBe("rest");
  });

  it("settles a session on the athlete's local day, not the UTC day", () => {
    // 06:30 UTC on 20 October is 23:30 on 19 October in Los Angeles (PDT).
    const evening = makeActivity({ startDate: "2026-10-20T06:30:00Z" });

    const local = applyCompletedDays(
      makeWeek(),
      [evening],
      "2026-10-21",
      "America/Los_Angeles",
    );
    expect(local.sessions[0]?.status).toBe("completed");
    expect(local.sessions[1]?.status).toBe("missed");

    const utc = applyCompletedDays(makeWeek(), [evening], "2026-10-21", "UTC");
    expect(utc.sessions[0]?.status).toBe("missed");
    expect(utc.sessions[1]?.status).toBe("completed");
  });

  it("settles an early morning session on the athlete's next local day", () => {
    // 15:30 UTC on 19 October is 00:30 on 20 October in Tokyo (JST).
    const early = makeActivity({ startDate: "2026-10-19T15:30:00Z" });

    const applied = applyCompletedDays(
      makeWeek(),
      [early],
      "2026-10-21",
      "Asia/Tokyo",
    );

    expect(applied.sessions[0]?.status).toBe("missed");
    expect(applied.sessions[1]?.status).toBe("completed");
  });
});
