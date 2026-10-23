import { describe, expect, it } from "bun:test";
import {
  activityCommentRequestSchema,
  coachPlanResponseSchema,
  coachPlanSchema,
  coachingInputSaveResponseSchema,
  dailyPlanUpdateSchema,
  dayPlanSchema,
  initialBlockUpdateSchema,
  manualActivitySchema,
  planDateSchema,
  seasonPlanUpdateSchema,
  weekPlanSchema,
  weeklyNoteResponseSchema,
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
      optional: false,
      optionalRationale:
        "This easy run keeps the week consistent; skip it only if you feel unusually tired.",
      status: "planned",
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

  it("accepts a partially completed session", () => {
    const week = makeWeek();
    expect(
      weekPlanSchema.parse({
        ...week,
        sessions: week.sessions.map((session, index) =>
          index === 0 ? { ...session, status: "partial" } : session,
        ),
      }).sessions[0]?.status,
    ).toBe("partial");
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

  it("defaults optional to false and accepts an optional rationale", () => {
    const parsed = dayPlanSchema.parse({
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "45 minutes easy.",
      durationMinutes: 45,
      intensity: "easy",
      rationale: "Easy aerobic work.",
    });
    expect(parsed.optional).toBe(false);
    expect(parsed.optionalRationale).toBeUndefined();
    expect(parsed.status).toBe("planned");

    const withRationale = dayPlanSchema.parse({
      ...parsed,
      optional: true,
      optionalRationale: "Skip it if your legs are tired.",
    });
    expect(withRationale.optional).toBe(true);
    expect(withRationale.optionalRationale).toBe(
      "Skip it if your legs are tired.",
    );
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

describe("coaching-input feedback schemas", () => {
  it("requires the commented activity's date", () => {
    expect(() =>
      activityCommentRequestSchema.parse({
        today: "2026-10-21",
        comment: "Felt strong.",
      }),
    ).toThrow();
  });

  it("accepts a save response with no reply", () => {
    const parsed = coachingInputSaveResponseSchema.parse({
      message: "Comment saved",
    });
    expect(parsed.reply).toBeNull();
  });

  it("defaults a manual activity's reply to null", () => {
    const parsed = manualActivitySchema.parse({
      id: 7,
      startDate: "2026-10-21",
      details: "Pool swim",
    });
    expect(parsed.coachReply).toBeNull();
  });

  it("returns a weekly note with its reply", () => {
    const parsed = weeklyNoteResponseSchema.parse({
      note: "No training on Thursday.",
      reply: {
        text: "Understood; I moved Thursday's session.",
        model: "openrouter/auto",
        generatedAt: "2026-10-21T08:00:00Z",
      },
    });
    expect(parsed.reply?.text).toContain("Thursday");
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
        optional: true,
        optionalRationale:
          "Skip it if your legs are tired; the plan still works without it.",
      },
      week: makeWeek(),
    });
    expect(parsed.today.alternatives).toEqual([]);
    expect(parsed.today.status).toBe("planned");
    expect(parsed.today.optional).toBe(true);
    expect(parsed.today.optionalRationale).toBe(
      "Skip it if your legs are tired; the plan still works without it.",
    );
    expect(parsed.week.sessions).toHaveLength(7);
  });
});
