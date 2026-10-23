import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import {
  latestActivityAnalysisTimestamp,
  latestAnswerTimestamp,
  planIsStale,
  planPending,
} from "./status.js";

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Marathon",
      startDate: "2026-10-21",
      endDate: "2027-04-01",
      rationale: "Build aerobic base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-21",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      rationale: "Establish consistent volume.",
      startDate: "2026-10-21",
      endDate: "2026-12-01",
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
      rationale: "Keep the week easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout" as const,
        title: `Session ${index + 1}`,
        description: "Easy.",
        durationMinutes: 45,
        intensity: "easy" as const,
        status: "planned" as const,
      })),
    },
    today: {
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "Easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      optionalRationale:
        "This easy run keeps the week consistent; skip it only if you feel unusually tired.",
      status: "planned",
    },
    tomorrow: null,
  };
}

describe("planPending", () => {
  it("marks every level when there is no plan", () => {
    expect(planPending(null, "2026-10-21")).toEqual({
      initial: true,
      day: true,
      week: true,
      block: true,
      tomorrow: true,
    });
  });

  it("marks nothing when the plan covers today", () => {
    expect(planPending(makePlan(), "2026-10-21")).toEqual({
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: false,
    });
  });

  it("marks tomorrow when requested and it is missing", () => {
    expect(planPending(makePlan(), "2026-10-21", true)).toEqual({
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: true,
    });
  });

  it("does not mark tomorrow when the plan already has it", () => {
    const plan = makePlan();
    plan.tomorrow = {
      date: "2026-10-22",
      type: "workout",
      title: "Easy run",
      description: "Easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      optionalRationale:
        "This easy run keeps the week consistent; skip it only if you feel unusually tired.",
      status: "planned",
    };
    expect(planPending(plan, "2026-10-21", true).tomorrow).toBe(false);
  });

  it("marks the day and week when the date moves on", () => {
    expect(planPending(makePlan(), "2026-10-22")).toEqual({
      initial: false,
      day: true,
      week: false,
      block: false,
      tomorrow: false,
    });
    expect(planPending(makePlan(), "2026-10-26")).toEqual({
      initial: false,
      day: true,
      week: true,
      block: false,
      tomorrow: false,
    });
  });

  it("marks the block when today is outside its range", () => {
    expect(planPending(makePlan(), "2026-12-02")).toEqual({
      initial: false,
      day: true,
      week: true,
      block: true,
      tomorrow: false,
    });
  });
});

describe("planIsStale", () => {
  it("is stale when the current answers are newer", () => {
    expect(
      planIsStale(
        new Date("2026-10-20T10:00:00Z"),
        new Date("2026-10-21T10:00:00Z"),
      ),
    ).toBe(true);
  });

  it("is not stale when the plan matches the answers", () => {
    const timestamp = new Date("2026-10-21T10:00:00Z");
    expect(planIsStale(timestamp, timestamp)).toBe(false);
  });

  it("treats a missing stored timestamp as older", () => {
    expect(planIsStale(null, new Date("2026-10-21T10:00:00Z"))).toBe(true);
    expect(planIsStale(null, null)).toBe(false);
  });
});

describe("latestActivityAnalysisTimestamp", () => {
  it("returns the newest analysis, ignoring unanalysed activities", () => {
    expect(
      latestActivityAnalysisTimestamp([
        { analysis: null },
        { analysis: { generatedAt: "2026-10-20T10:00:00Z" } },
        { analysis: { generatedAt: "2026-10-21T10:00:00Z" } },
      ]),
    ).toEqual(new Date("2026-10-21T10:00:00Z"));
  });

  it("returns null without an analysis", () => {
    expect(latestActivityAnalysisTimestamp([])).toBeNull();
    expect(latestActivityAnalysisTimestamp([{ analysis: null }])).toBeNull();
  });
});

describe("latestAnswerTimestamp", () => {
  it("returns the newest answeredAt, ignoring unanswered questions", () => {
    expect(
      latestAnswerTimestamp([
        { answeredAt: new Date("2026-10-20T10:00:00Z") },
        { answeredAt: new Date("2026-10-21T10:00:00Z") },
        { answeredAt: null },
      ]),
    ).toEqual(new Date("2026-10-21T10:00:00Z"));
  });

  it("returns null when nothing was answered", () => {
    expect(latestAnswerTimestamp([{ answeredAt: null }])).toBeNull();
    expect(latestAnswerTimestamp([])).toBeNull();
  });
});
