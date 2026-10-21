import { describe, expect, it } from "bun:test";
import {
  coachPlanResponseSchema,
  coachPlanSchema,
  dailyPlanUpdateSchema,
  dayPlanSchema,
  initialBlockUpdateSchema,
  planDateSchema,
  seasonPlanUpdateSchema,
  weekPlanSchema,
} from "./plan.js";

function makeWeek() {
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

function makePlan() {
  return {
    season: {
      goal: "Sub-4-hour marathon",
      startDate: "2026-10-21",
      endDate: "2027-04-01",
      rationale: "Build a strong aerobic base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic endurance",
          startDate: "2026-10-21",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic endurance",
      rationale: "Establish consistent volume.",
      startDate: "2026-10-21",
      endDate: "2026-12-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic base",
          targetLoad: "Easy",
        },
      ],
    },
    week: makeWeek(),
    today: {
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "45 minutes at conversational pace.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: ["Cross-train for 45 minutes."],
      rationale: "Easy aerobic work supports recovery.",
    },
    tomorrow: null,
  };
}

describe("planDateSchema", () => {
  it("accepts calendar dates and rejects other formats", () => {
    expect(planDateSchema.safeParse("2026-10-21").success).toBe(true);
    expect(planDateSchema.safeParse("2026-10-21T00:00:00Z").success).toBe(
      false,
    );
    expect(planDateSchema.safeParse("21-10-2026").success).toBe(false);
  });
});

describe("weekPlanSchema", () => {
  it("requires exactly seven sessions", () => {
    const week = makeWeek();
    expect(weekPlanSchema.safeParse(week).success).toBe(true);
    expect(
      weekPlanSchema.safeParse({
        ...week,
        sessions: week.sessions.slice(0, 6),
      }).success,
    ).toBe(false);
  });
});

describe("dayPlanSchema", () => {
  it("defaults alternatives to an empty list", () => {
    const parsed = dayPlanSchema.parse({
      date: "2026-10-21",
      type: "rest",
      title: "Rest",
      description: "Take the day off.",
      durationMinutes: 0,
      intensity: "rest",
      rationale: "Recovery is part of the plan.",
    });
    expect(parsed.alternatives).toEqual([]);
  });
});

describe("coachPlanSchema", () => {
  it("parses a complete four-level plan", () => {
    const parsed = coachPlanSchema.parse(makePlan());
    expect(parsed.season.blocks).toHaveLength(1);
    expect(parsed.week.sessions).toHaveLength(7);
    expect(parsed.today.title).toBe("Easy run");
  });
});

describe("split build schemas", () => {
  it("parses the season and first block as separate steps", () => {
    const plan = makePlan();
    expect(seasonPlanUpdateSchema.parse({ season: plan.season })).toEqual({
      season: plan.season,
    });
    expect(initialBlockUpdateSchema.parse({ block: plan.block })).toEqual({
      block: plan.block,
    });
  });
});

describe("coachPlanResponseSchema", () => {
  it("accepts an empty state with a generation status", () => {
    const parsed = coachPlanResponseSchema.parse({
      plan: null,
      generatedAt: null,
      generation: {
        status: "idle",
        step: null,
        progress: 0,
        error: null,
        updatedAt: "2026-10-21T08:00:00Z",
      },
      stale: false,
      pending: {
        initial: true,
        day: true,
        week: true,
        block: true,
        tomorrow: true,
      },
    });
    expect(parsed.plan).toBeNull();
    expect(parsed.pending.initial).toBe(true);
  });
});

describe("dailyPlanUpdateSchema", () => {
  it("parses a day and a revised week", () => {
    const parsed = dailyPlanUpdateSchema.parse({
      today: {
        date: "2026-10-21",
        type: "workout",
        title: "Easy run",
        description: "45 minutes easy.",
        durationMinutes: 45,
        intensity: "easy",
        rationale: "Easy aerobic work.",
      },
      week: makeWeek(),
    });
    expect(parsed.today.alternatives).toEqual([]);
    expect(parsed.week.sessions).toHaveLength(7);
  });
});
