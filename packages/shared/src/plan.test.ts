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
  planGenerateInputSchema,
  seasonPlanUpdateSchema,
  targetDayUpdateSchema,
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
    nextWeek: null,
    nextBlock: null,
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

  it("accepts an estimated FTP and per-session training load", () => {
    const week = makeWeek();
    const parsed = weekPlanSchema.parse({
      ...week,
      estimatedFtpWatts: 250,
      sessions: week.sessions.map((session, index) =>
        index === 0
          ? {
              ...session,
              estimatedTss: 60,
              estimatedFtpWatts: 252,
              trainingLoad: { tss: 60, atl: 8.6, ctl: 1.4, tsb: -7.2 },
            }
          : session,
      ),
    });

    expect(parsed.estimatedFtpWatts).toBe(250);
    expect(parsed.sessions[0]?.trainingLoad?.tss).toBe(60);
    expect(parsed.sessions[0]?.estimatedTss).toBe(60);
    expect(parsed.sessions[0]?.estimatedFtpWatts).toBe(252);
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
    expect(parsed.nextWeek).toBeNull();
    expect(parsed.nextBlock).toBeNull();
  });

  it("defaults the next period to null for plans stored before it existed", () => {
    const legacy: Record<string, unknown> = { ...makePlan() };
    delete legacy.nextWeek;
    delete legacy.nextBlock;

    const parsed = coachPlanSchema.parse(legacy);

    expect(parsed.nextWeek).toBeNull();
    expect(parsed.nextBlock).toBeNull();
  });
});

describe("split build schemas", () => {
  it("parses the season and first block as separate steps", () => {
    const plan = makePlan();
    expect(seasonPlanUpdateSchema.parse({ season: plan.season })).toEqual({
      season: plan.season,
      bodyMetrics: [],
    });
    expect(initialBlockUpdateSchema.parse({ block: plan.block })).toEqual({
      block: plan.block,
      bodyMetrics: [],
    });
  });

  it("keeps the body metrics the coach found", () => {
    const plan = makePlan();
    const parsed = seasonPlanUpdateSchema.parse({
      season: plan.season,
      bodyMetrics: [
        { date: "2026-10-21", weightKg: 89.5, bodyFatPercent: 24.5 },
      ],
    });

    expect(parsed.bodyMetrics).toEqual([
      { date: "2026-10-21", weightKg: 89.5, bodyFatPercent: 24.5 },
    ]);
  });

  it("defaults a body metric that gives only one value", () => {
    const plan = makePlan();
    const parsed = seasonPlanUpdateSchema.parse({
      season: plan.season,
      bodyMetrics: [{ date: "2026-10-21", weightKg: 89.5 }],
    });

    expect(parsed.bodyMetrics[0]?.bodyFatPercent).toBeNull();
  });
});

describe("targetDayUpdateSchema", () => {
  it("ignores an unused malformed day-after-target field", () => {
    const plan = makePlan();

    const parsed = targetDayUpdateSchema.parse({
      today: plan.today,
      week: plan.week,
      tomorrow: { ...plan.today, date: "2026-10-22", type: "rest day" },
    });

    expect(parsed.today.date).toBe("2026-10-21");
    expect(parsed.week.startDate).toBe("2026-10-19");
    expect("tomorrow" in parsed).toBe(false);
  });

  it("rejects a target day outside the week", () => {
    const plan = makePlan();

    expect(() =>
      targetDayUpdateSchema.parse({
        today: { ...plan.today, date: "2026-11-02" },
        week: plan.week,
      }),
    ).toThrow();
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
        nextWeek: true,
        nextBlock: true,
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

describe("weather on plan sessions", () => {
  it("keeps an attached forecast and outdoor flag", () => {
    const weather = {
      date: "2026-10-21",
      icon: "rain" as const,
      temperatureMaxC: 9,
      temperatureMinC: 5,
      windMaxMs: 4,
      gustMaxMs: 8,
      precipitationMm: 2.5,
    };
    const forecasts = {
      openMeteo: weather,
      yr: { ...weather, icon: "sun" as const },
      combined: weather,
    };
    const parsed = dayPlanSchema.parse({
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "45 minutes easy.",
      durationMinutes: 45,
      intensity: "easy",
      rationale: "Easy aerobic work.",
      outdoor: false,
      canBeOutdoor: true,
      weather,
      forecasts,
    });
    expect(parsed.outdoor).toBe(false);
    expect(parsed.canBeOutdoor).toBe(true);
    expect(parsed.weather?.icon).toBe("rain");
    expect(parsed.forecasts?.yr?.icon).toBe("sun");

    const week = makeWeek();
    const withWeather = weekPlanSchema.parse({
      ...week,
      sessions: week.sessions.map((session, index) =>
        index === 2
          ? {
              ...session,
              weather,
              forecasts,
              outdoor: true,
              canBeOutdoor: false,
            }
          : session,
      ),
    });
    expect(withWeather.sessions[2]?.weather?.gustMaxMs).toBe(8);
    expect(withWeather.sessions[2]?.canBeOutdoor).toBe(false);
    expect(withWeather.sessions[2]?.forecasts?.openMeteo?.icon).toBe("rain");
  });

  it("leaves the fields optional for plans stored before weather existed", () => {
    const parsed = dayPlanSchema.parse({
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "45 minutes easy.",
      durationMinutes: 45,
      intensity: "easy",
      rationale: "Easy aerobic work.",
    });
    expect(parsed.outdoor).toBeUndefined();
    expect(parsed.canBeOutdoor).toBeUndefined();
    expect(parsed.weather).toBeUndefined();
  });
});

describe("plan generation mode", () => {
  it("defaults to automatic generation", () => {
    const parsed = planGenerateInputSchema.parse({ today: "2026-10-21" });

    expect(parsed.mode).toBe("auto");
    expect(parsed.force).toBe(false);
  });

  it("accepts the explicit new-season and update-season modes", () => {
    expect(
      planGenerateInputSchema.parse({
        today: "2026-10-21",
        mode: "newSeason",
      }).mode,
    ).toBe("newSeason");
    expect(
      planGenerateInputSchema.parse({
        today: "2026-10-21",
        mode: "updateSeason",
      }).mode,
    ).toBe("updateSeason");
  });

  it("rejects an unknown mode", () => {
    expect(
      planGenerateInputSchema.safeParse({
        today: "2026-10-21",
        mode: "refresh",
      }).success,
    ).toBe(false);
  });
});
