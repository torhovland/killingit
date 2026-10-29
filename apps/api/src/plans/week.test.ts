import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, WeekPlan } from "@killingit/shared";
import { applyCompletedDays, mirrorDay } from "./week.js";

function makeWeek(): WeekPlan {
  return {
    startDate: "2026-10-19",
    focus: "Aerobic base",
    rationale: "Keep the week easy.",
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${String(19 + index)}`,
      day: "Monday",
      type: index === 6 ? "rest" : "workout",
      title: `Session ${index + 1}`,
      description: "Easy aerobic work.",
      durationMinutes: 45,
      intensity: index === 6 ? "rest" : "easy",
      status: index === 6 ? "rest" : "planned",
    })),
  };
}

function makeActivity(
  overrides: Partial<AnalyzedActivity> = {},
): AnalyzedActivity {
  return {
    id: 1,
    name: "Morning Run",
    type: "running",
    startDate: "2026-10-19T06:30:00Z",
    distance: 10000,
    movingTime: 2700,
    elapsedTime: 2800,
    totalElevationGain: 80,
    sampleCount: 100,
    samples: [],
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}

describe("applyCompletedDays", () => {
  it("uses completed activities for past days and marks missing ones", () => {
    const week = applyCompletedDays(makeWeek(), [makeActivity()], "2026-10-21");

    expect(week.rationale).toBe("Keep the week easy.");

    const monday = week.sessions[0];
    expect(monday?.status).toBe("completed");
    expect(monday?.title).toBe("Morning Run");
    expect(monday?.description).toContain("Completed: Running");
    expect(monday?.description).toContain("10.00 km");
    expect(monday?.durationMinutes).toBe(47);
    expect(monday?.description).toContain("47 min");

    const tuesday = week.sessions[1];
    expect(tuesday?.status).toBe("missed");
    expect(tuesday?.title).toBe("No activity recorded");
    expect(tuesday?.durationMinutes).toBe(0);
  });

  it("keeps today and future days planned", () => {
    const week = applyCompletedDays(makeWeek(), [], "2026-10-21");

    expect(week.sessions[2]?.status).toBe("planned");
    expect(week.sessions[2]?.title).toBe("Session 3");
    expect(week.sessions[3]?.status).toBe("planned");
    expect(week.sessions[6]?.status).toBe("rest");
  });

  it("does not invent a one-minute duration for a manual activity", () => {
    const week = applyCompletedDays(makeWeek(), [], "2026-10-21", [
      {
        id: 5,
        startDate: "2026-10-19",
        details: "Strength session at the gym",
      },
    ]);

    const monday = week.sessions[0];
    expect(monday?.status).toBe("completed");
    expect(monday?.title).toBe("Strength session at the gym");
    expect(monday?.durationMinutes).toBe(0);
    expect(monday?.description).toBe("Completed: logged manually");
    expect(monday?.description).not.toContain("1 min");
  });

  it("marks today's completed workout on the week with slack", () => {
    const week = makeWeek();
    // The session plans 45 minutes; 40 minutes is within the slack.
    const activity = makeActivity({
      startDate: "2026-10-21T06:30:00Z",
      elapsedTime: 40 * 60,
      movingTime: 40 * 60,
      name: "Lunch Ride",
    });

    const applied = applyCompletedDays(week, [activity], "2026-10-21");
    const today = applied.sessions[2];

    expect(today?.status).toBe("completed");
    expect(today?.title).toBe("Lunch Ride");
    expect(today?.description).toContain("Completed: Running");
    expect(today?.durationMinutes).toBe(40);
  });

  it("marks today's workout as partial when it was much shorter", () => {
    const activity = makeActivity({
      startDate: "2026-10-21T06:30:00Z",
      elapsedTime: 15 * 60,
      movingTime: 15 * 60,
    });

    const applied = applyCompletedDays(makeWeek(), [activity], "2026-10-21");
    expect(applied.sessions[2]?.status).toBe("partial");
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
    );
    expect(applied.sessions[0]?.status).toBe("partial");
  });

  it("mirrors today's day plan into the week", () => {
    const applied = applyCompletedDays(
      makeWeek(),
      [makeActivity({ startDate: "2026-10-21T06:30:00Z" })],
      "2026-10-21",
      [],
      {
        ...makeWeek().sessions[2]!,
        date: "2026-10-21",
        title: "Completed easy run",
        description: "Completed: 45 easy minutes.",
        status: "completed",
        alternatives: [],
        rationale: "Matches the plan.",
        optional: false,
        outdoor: false,
        canBeOutdoor: true,
      },
    );

    const today = applied.sessions[2];
    expect(today?.title).toBe("Completed easy run");
    expect(today?.description).toBe("Completed: 45 easy minutes.");
    expect(today?.status).toBe("completed");
    expect(today?.outdoor).toBe(false);
    expect(today?.canBeOutdoor).toBe(true);
  });

  it("mirrors an indoor/outdoor classification into the week", () => {
    const week = makeWeek();
    const mirrored = mirrorDay(week, {
      date: "2026-10-22",
      type: "workout",
      title: "Easy ride",
      description: "Easy ride.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Base building.",
      optional: false,
      status: "planned",
      outdoor: false,
      canBeOutdoor: true,
    });

    expect(week.sessions[3]?.canBeOutdoor).toBeUndefined();
    expect(mirrored.sessions[3]?.outdoor).toBe(false);
    expect(mirrored.sessions[3]?.canBeOutdoor).toBe(true);
  });

  it("mirrors an already completed today even without the activity", () => {
    const applied = applyCompletedDays(makeWeek(), [], "2026-10-21", [], {
      date: "2026-10-21",
      type: "workout",
      title: "Completed ride",
      description: "Completed: 50 min ride.",
      durationMinutes: 50,
      intensity: "moderate",
      alternatives: [],
      rationale: "The ride matched the plan.",
      optional: false,
      status: "completed",
    });

    const today = applied.sessions[2];
    expect(today?.status).toBe("completed");
    expect(today?.title).toBe("Completed ride");
  });

  it("keeps a past rest day as rest", () => {
    const week = makeWeek();
    const restWeek: WeekPlan = {
      ...week,
      sessions: week.sessions.map((session, index) =>
        index === 0 ? { ...session, type: "rest", intensity: "rest" } : session,
      ),
    };

    const applied = applyCompletedDays(restWeek, [], "2026-10-21");
    expect(applied.sessions[0]?.status).toBe("rest");
  });
});
