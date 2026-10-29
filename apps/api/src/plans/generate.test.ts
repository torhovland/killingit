import { describe, expect, it } from "bun:test";
import type {
  BlockPlan,
  CoachPlan,
  DailyWeather,
  DayPlan,
  PlanGenerationStatus,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import {
  INITIAL_BLOCK_SYSTEM_PROMPT,
  SEASON_PLAN_SYSTEM_PROMPT,
} from "../llm/planInitialPrompt.js";
import type { LlmCompletionRequest, LlmProvider } from "../llm/openrouter.js";
import {
  DAILY_UPDATE_SYSTEM_PROMPT,
  PLAN_UPDATE_SYSTEM_PROMPT,
  WEEKLY_UPDATE_SYSTEM_PROMPT,
} from "../llm/planUpdatePrompt.js";
import { addDays, startOfWeek } from "./dates.js";
import {
  planFtpEstimates,
  runPlanGeneration,
  type PlanGenerationContext,
} from "./generate.js";
import { planPending } from "./status.js";
import type { PlanGenerationStep } from "./steps.js";
import {
  idleGenerationStatus,
  type PlanGenerationStore,
  type PlanStore,
  type StoredPlan,
} from "./store.js";

function makeSeason(): SeasonPlan {
  return {
    goal: "Sub-4-hour marathon",
    startDate: "2026-10-21",
    endDate: "2027-04-01",
    rationale: "Build aerobic base before marathon-specific work.",
    blocks: [
      {
        name: "Base",
        focus: "Aerobic endurance",
        startDate: "2026-10-21",
        endDate: "2026-12-01",
        weekCount: 6,
      },
    ],
  };
}

function makeBlock(
  startDate = "2026-10-21",
  endDate = "2026-12-01",
): BlockPlan {
  return {
    name: "Base",
    focus: "Aerobic endurance",
    rationale: "Establish consistent aerobic volume.",
    startDate,
    endDate,
    weeks: [
      {
        number: 1,
        startDate,
        focus: "Aerobic base",
        targetLoad: "Easy",
      },
    ],
  };
}

function makeWeek(startDate: string): WeekPlan {
  return {
    startDate,
    focus: "Aerobic base",
    rationale: "Keep the week easy and consistent.",
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: addDays(startDate, index),
      day: "Monday",
      type: "workout",
      title: `Session ${index + 1}`,
      description: "Easy aerobic work.",
      durationMinutes: 45,
      intensity: "easy",
      status: "planned",
    })),
  };
}

/** The same week with a structured workout on every day. */
function makeBikeWeek(startDate: string): WeekPlan {
  const week = makeWeek(startDate);
  return {
    ...week,
    sessions: week.sessions.map((session) => ({
      ...session,
      bikeWorkout: {
        ftpWatts: 250,
        intervals: [{ durationSeconds: 600, powerPercent: 75 }],
      },
    })),
  };
}

/**
 * A week whose days before `today` already carry their settled results, so a
 * later `applyCompletedDays` pass leaves the stored week unchanged.
 */
function makeEndedWeek(startDate: string, today: string): WeekPlan {
  const week = makeWeek(startDate);
  return {
    ...week,
    sessions: week.sessions.map((session) =>
      session.date < today
        ? {
            ...session,
            title: "No activity recorded",
            description: "The athlete did not record a workout for this day.",
            durationMinutes: 0,
            status: "missed",
          }
        : session,
    ),
  };
}

function makeDay(date: string): DayPlan {
  return {
    date,
    type: "workout",
    title: "Easy run",
    description: "45 minutes easy.",
    durationMinutes: 45,
    intensity: "easy",
    alternatives: [],
    rationale: "Easy aerobic work supports recovery.",
    optional: false,
    optionalRationale:
      "This easy run keeps the week consistent; skip it only if you feel unusually tired.",
    status: "planned",
  };
}

function makePlan(today = "2026-10-21"): CoachPlan {
  return {
    season: makeSeason(),
    block: makeBlock(),
    week: makeWeek("2026-10-19"),
    today: makeDay(today),
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
  };
}

/** A complete plan returned by the single plan-update prompt. */
function makeUpdate(
  today = "2026-10-21",
  overrides: Partial<CoachPlan> = {},
): string {
  return JSON.stringify({ ...makePlan(today), ...overrides });
}

function weekForecast(icon: DailyWeather["icon"]): DailyWeather[] {
  return Array.from({ length: 7 }, (_, index) => ({
    date: `2026-10-${String(19 + index)}`,
    icon,
    temperatureMaxC: 15,
    temperatureMinC: 7,
    windMaxMs: 3,
    gustMaxMs: 5,
    precipitationMm: 0,
  }));
}

function withWeather(
  plan: CoachPlan,
  forecast: readonly DailyWeather[],
): CoachPlan {
  const byDate = new Map(forecast.map((day) => [day.date, day]));
  return {
    ...plan,
    week: {
      ...plan.week,
      sessions: plan.week.sessions.map((session) => ({
        ...session,
        weather: byDate.get(session.date) ?? null,
      })),
    },
  };
}

function buildResponses(today = "2026-10-21") {
  return {
    season: JSON.stringify({ season: makeSeason() }),
    block: JSON.stringify({ block: makeBlock() }),
    weekly: JSON.stringify({
      week: makeWeek(startOfWeek(today)),
      block: makeBlock(),
    }),
    daily: JSON.stringify({
      today: makeDay(today),
      week: makeWeek(startOfWeek(today)),
    }),
    planUpdate: JSON.stringify({
      ...makePlan(today),
      season: makeRefreshedSeason(today),
      block: makeBlock(today, "2026-12-31"),
      week: makeWeek(startOfWeek(today)),
      today: makeDay(today),
    }),
  };
}

/** The remaining season returned by a refresh: current block plus a future one. */
function makeRefreshedSeason(startDate = "2026-10-21"): SeasonPlan {
  return {
    goal: "Sub-4-hour marathon",
    startDate,
    endDate: "2027-04-01",
    rationale: "Re-plan the rest of the season around current fitness.",
    blocks: [
      {
        name: "Rebuild",
        focus: "Aerobic endurance",
        startDate,
        endDate: "2026-12-31",
        weekCount: 7,
      },
      {
        name: "Peak",
        focus: "Threshold and race pace",
        startDate: "2027-01-01",
        endDate: "2027-04-01",
        weekCount: 13,
      },
    ],
  };
}

/** A stored plan in the middle of a season with one completed block. */
function makeMidSeasonPlan(today = "2026-11-15"): CoachPlan {
  const plan = makePlan(today);
  const season = makeSeason();
  return {
    ...plan,
    season: {
      ...season,
      startDate: "2026-10-01",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic endurance",
          startDate: "2026-10-01",
          endDate: "2026-10-31",
          weekCount: 4,
        },
        {
          name: "Build",
          focus: "Threshold",
          startDate: "2026-11-01",
          endDate: "2026-12-31",
          weekCount: 9,
        },
      ],
    },
    block: makeBlock("2026-11-01", "2026-12-31"),
    week: makeWeek("2026-11-09"),
    today: makeDay(today),
  };
}

function makeStoredPlan(
  plan: CoachPlan,
  answersUpdatedAt: Date | null = new Date("2026-10-20T10:00:00Z"),
  coachingInputsUpdatedAt: Date | null = null,
  activitiesUpdatedAt: Date | null = null,
): StoredPlan {
  return {
    plan,
    answersUpdatedAt,
    coachingInputsUpdatedAt,
    activitiesUpdatedAt,
    generatedAt: new Date("2026-10-20T10:00:00Z"),
  };
}

function makeContext(
  provider: LlmProvider,
  answersUpdatedAt: Date | null = new Date("2026-10-20T10:00:00Z"),
  coachingInputsUpdatedAt: Date | null = null,
): PlanGenerationContext {
  return {
    answers: [{ prompt: "Goal?", answer: "Marathon", skipped: false }],
    answersUpdatedAt,
    activities: [],
    manualActivities: [],
    activityComments: [],
    weeklyNote: null,
    coachingInputsUpdatedAt,
    provider,
    apiKey: "test-key",
    model: "test-model",
  };
}

class MemoryPlanStore implements PlanStore {
  saved: StoredPlan | null;

  constructor(initial: StoredPlan | null) {
    this.saved = initial;
  }

  load(): Promise<StoredPlan | null> {
    return Promise.resolve(this.saved);
  }

  save(
    _userId: number,
    plan: CoachPlan,
    answersUpdatedAt: Date | null,
    coachingInputsUpdatedAt: Date | null = null,
    activitiesUpdatedAt: Date | null = null,
  ): Promise<StoredPlan> {
    this.saved = {
      plan,
      answersUpdatedAt,
      coachingInputsUpdatedAt,
      activitiesUpdatedAt,
      generatedAt: new Date(),
    };
    return Promise.resolve(this.saved);
  }
}

class MemoryGenerationStore implements PlanGenerationStore {
  status: PlanGenerationStatus = idleGenerationStatus();
  steps: string[] = [];

  load(): Promise<PlanGenerationStatus> {
    return Promise.resolve(this.status);
  }

  begin(): Promise<boolean> {
    this.status = {
      ...this.status,
      status: "running",
      step: "Preparing your plan",
      progress: 5,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve(true);
  }

  update(_userId: number, step: PlanGenerationStep): Promise<void> {
    this.steps.push(step.label);
    this.status = {
      ...this.status,
      status: "running",
      step: step.label,
      progress: step.target,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }

  heartbeat(): Promise<void> {
    return Promise.resolve();
  }

  finish(): Promise<void> {
    this.status = {
      ...this.status,
      status: "done",
      step: "Your plan is ready",
      progress: 100,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }

  fail(_userId: number, error: string): Promise<void> {
    this.status = {
      ...this.status,
      status: "error",
      error,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }
}

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  calls: string[] = [];

  constructor(
    private readonly responses: {
      season?: string;
      block?: string;
      daily?: string;
      weekly?: string;
      planUpdate?: string;
    },
  ) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    const system = request.messages[0]?.content ?? "";
    if (system === SEASON_PLAN_SYSTEM_PROMPT) {
      this.calls.push("season");
      return this.respond(this.responses.season);
    }
    if (system === INITIAL_BLOCK_SYSTEM_PROMPT) {
      this.calls.push("block");
      return this.respond(this.responses.block);
    }
    if (system === DAILY_UPDATE_SYSTEM_PROMPT) {
      this.calls.push("daily");
      return this.respond(this.responses.daily);
    }
    if (system === WEEKLY_UPDATE_SYSTEM_PROMPT) {
      this.calls.push("weekly");
      return this.respond(this.responses.weekly);
    }
    if (system === PLAN_UPDATE_SYSTEM_PROMPT) {
      this.calls.push("plan-update");
      return this.respond(this.responses.planUpdate);
    }
    return Promise.reject(new Error("unexpected prompt"));
  }

  private respond(response: string | undefined): Promise<string> {
    return response === undefined
      ? Promise.reject(new Error("no response configured"))
      : Promise.resolve(response);
  }
}

describe("runPlanGeneration", () => {
  it("builds all four levels in sequential steps when there is no plan", async () => {
    const provider = new FakeProvider(buildResponses());
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: null,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["season", "block", "weekly", "daily"]);
    expect(saved?.plan.today.date).toBe("2026-10-21");
    expect(generations.status.status).toBe("done");
    expect(generations.steps).toContain("Designing your season");
    expect(generations.steps).toContain("Designing your block");
    expect(generations.steps).toContain("Building your week");
  });

  it("keeps detailed workouts only for today and tomorrow", async () => {
    const today = "2026-10-21";
    const bikeWorkout = {
      ftpWatts: 250,
      intervals: [{ durationSeconds: 600, powerPercent: 75 }],
    };
    const provider = new FakeProvider({
      ...buildResponses(today),
      weekly: JSON.stringify({
        week: makeBikeWeek(startOfWeek(today)),
        block: makeBlock(),
      }),
      daily: JSON.stringify({
        today: { ...makeDay(today), bikeWorkout },
        week: makeBikeWeek(startOfWeek(today)),
      }),
    });

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      plan: null,
      context: makeContext(provider),
      plans: new MemoryPlanStore(null),
      generations: new MemoryGenerationStore(),
    });

    const sessions = saved?.plan.week.sessions ?? [];
    expect(
      sessions.find((session) => session.date === "2026-10-22")?.bikeWorkout,
    ).not.toBeNull();
    expect(
      sessions
        .filter((session) => session.date > "2026-10-22")
        .every((session) => session.bikeWorkout == null),
    ).toBe(true);
  });

  it("stores one FTP point per planned day from today onward", () => {
    const plan = makePlan("2026-10-21");
    const estimates = planFtpEstimates({
      ...plan,
      week: {
        ...plan.week,
        estimatedFtpWatts: 255,
        sessions: plan.week.sessions.map((session) =>
          session.date === "2026-10-22"
            ? { ...session, estimatedFtpWatts: 260 }
            : session,
        ),
      },
    });

    expect(estimates.map((entry) => entry.date)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(estimates.find((entry) => entry.date === "2026-10-21")?.watts).toBe(
      255,
    );
    expect(estimates.find((entry) => entry.date === "2026-10-22")?.watts).toBe(
      260,
    );
  });

  it("stores the body metrics the coach found in the input", async () => {
    const provider = new FakeProvider({
      ...buildResponses(),
      season: JSON.stringify({
        season: makeSeason(),
        bodyMetrics: [
          { date: "2026-10-21", weightKg: 89.5, bodyFatPercent: 24.5 },
        ],
      }),
      daily: JSON.stringify({
        today: makeDay("2026-10-21"),
        week: makeWeek(startOfWeek("2026-10-21")),
        bodyMetrics: [
          { date: "2026-10-21", weightKg: 89.5, bodyFatPercent: 24.5 },
          { date: "2026-10-20", weightKg: 90 },
        ],
      }),
    });
    const stored: unknown[] = [];

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: null,
      context: makeContext(provider),
      plans: new MemoryPlanStore(null),
      generations: new MemoryGenerationStore(),
      recordBodyMetrics: (points) => {
        stored.push(...points);
        return Promise.resolve();
      },
    });

    expect(stored).toEqual([
      { date: "2026-10-20", weightKg: 90, bodyFatPercent: null },
      { date: "2026-10-21", weightKg: 89.5, bodyFatPercent: 24.5 },
    ]);
    expect(saved?.plan.bodyMetrics).toEqual([
      { date: "2026-10-20", weightKg: 90, bodyFatPercent: null },
      { date: "2026-10-21", weightKg: 89.5, bodyFatPercent: 24.5 },
    ]);
  });

  it("keeps the plan when storing the body metrics fails", async () => {
    const provider = new FakeProvider({
      ...buildResponses(),
      daily: JSON.stringify({
        today: makeDay("2026-10-21"),
        week: makeWeek(startOfWeek("2026-10-21")),
        bodyMetrics: [{ date: "2026-10-21", weightKg: 89.5 }],
      }),
    });

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: null,
      context: makeContext(provider),
      plans: new MemoryPlanStore(null),
      generations: new MemoryGenerationStore(),
      recordBodyMetrics: () => Promise.reject(new Error("database down")),
    });

    expect(saved?.plan.today.date).toBe("2026-10-21");
  });

  it("refreshes the existing season when the answers are stale", async () => {
    const provider = new FakeProvider(buildResponses());
    const existing = makeStoredPlan(
      makePlan(),
      new Date("2026-10-19T10:00:00Z"),
    );
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context: makeContext(provider, new Date("2026-10-21T10:00:00Z")),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(generations.status.status).toBe("done");
  });

  it("fills a missing day and revises the week", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(makePlan("2026-10-20"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.today.date).toBe("2026-10-21");
    expect(generations.status.status).toBe("done");
  });

  it("revises the rest of the week on a new day without dropping the next period", async () => {
    const revisedWeek = makeWeek("2026-10-19");
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21", {
        week: {
          ...revisedWeek,
          sessions: revisedWeek.sessions.map((session) =>
            session.date === "2026-10-23"
              ? { ...session, title: "Revised Friday" }
              : session,
          ),
        },
      }),
    });
    const storedNextWeek = makeWeek("2026-10-26");
    const existing = makeStoredPlan({
      ...makePlan("2026-10-20"),
      nextWeek: storedNextWeek,
    });
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(
      saved?.plan.week.sessions.find((session) => session.date === "2026-10-23")
        ?.title,
    ).toBe("Revised Friday");
    expect(saved?.plan.nextWeek?.startDate).toBe(storedNextWeek.startDate);
  });

  it("revises the week and day when coaching inputs change", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(
      makePlan("2026-10-21"),
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-20T10:00:00Z"),
    );
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context: makeContext(
        provider,
        new Date("2026-10-20T10:00:00Z"),
        new Date("2026-10-21T10:00:00Z"),
      ),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.today.date).toBe("2026-10-21");
    expect(generations.status.status).toBe("done");
  });

  it("revises the week and day after a new activity analysis", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(makePlan("2026-10-21"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.activitiesUpdatedAt = new Date("2026-10-21T09:00:00Z");

    await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
  });

  it("does not revise when the stored plan already includes the analysis", async () => {
    const provider = new FakeProvider({});
    const existing = makeStoredPlan(
      makePlan("2026-10-21"),
      new Date("2026-10-20T10:00:00Z"),
      null,
      new Date("2026-10-20T09:00:00Z"),
    );
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.activitiesUpdatedAt = new Date("2026-10-20T09:00:00Z");

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
    expect(saved).toBe(existing);
  });

  it("marks a late-imported past activity on the week", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-22"),
    });
    const existing = makeStoredPlan(makePlan("2026-10-22"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.activities = [
      {
        id: 45,
        name: "Monday Run",
        type: "running",
        startDate: "2026-10-19T06:30:00Z",
        distance: 10000,
        movingTime: 2500,
        elapsedTime: 2500,
        totalElevationGain: 40,
        sampleCount: 0,
        analysis: {
          text: "A steady aerobic run.",
          model: "test-model",
          generatedAt: "2026-10-22T09:00:00Z",
        },
        analysisError: null,
        programAnalysis: null,
        comment: null,
        coachReply: null,
      },
    ];
    context.activitiesUpdatedAt = new Date("2026-10-22T09:00:00Z");

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-22",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    const monday = saved?.plan.week.sessions.find(
      (session) => session.date === "2026-10-19",
    );
    expect(monday?.status).toBe("completed");
    expect(monday?.title).toBe("Monday Run");
  });

  it("revises for an activity analysed while the plan was generating", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    // The plan was saved after the analysis, but its context did not include it.
    const existing = makeStoredPlan(
      makePlan("2026-10-21"),
      new Date("2026-10-20T10:00:00Z"),
      null,
      new Date("2026-10-20T08:00:00Z"),
    );
    existing.generatedAt = new Date("2026-10-21T10:00:00Z");
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.activitiesUpdatedAt = new Date("2026-10-21T09:00:00Z");

    await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
  });

  it("marks today's completed activity on both the day and the week", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(makePlan("2026-10-21"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.activities = [
      {
        id: 42,
        name: "Morning Run",
        type: "running",
        startDate: "2026-10-21T06:30:00Z",
        distance: 10000,
        movingTime: 2500,
        elapsedTime: 2500,
        totalElevationGain: 40,
        sampleCount: 0,
        analysis: null,
        analysisError: null,
        programAnalysis: null,
        comment: null,
        coachReply: null,
      },
    ];
    context.activitiesUpdatedAt = new Date("2026-10-21T09:00:00Z");

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    const todaySession = saved?.plan.week.sessions.find(
      (session) => session.date === "2026-10-21",
    );
    expect(saved?.plan.today.status).toBe("completed");
    expect(todaySession?.status).toBe("completed");
    expect(todaySession?.title).toBe(saved?.plan.today.title);
  });

  it("cascades a mismatched today result into the week", async () => {
    const current = makePlan("2026-10-21");
    const stored = makeStoredPlan({
      ...current,
      today: { ...current.today, status: "completed" },
    });
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.activities = [
      {
        id: 44,
        name: "Morning Run",
        type: "running",
        startDate: "2026-10-21T06:30:00Z",
        distance: 10000,
        movingTime: 2500,
        elapsedTime: 2500,
        totalElevationGain: 40,
        sampleCount: 0,
        analysis: null,
        analysisError: null,
        programAnalysis: null,
        comment: null,
        coachReply: null,
      },
    ];

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: stored,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    const todaySession = saved?.plan.week.sessions.find(
      (session) => session.date === "2026-10-21",
    );
    expect(saved?.plan.today.status).toBe("completed");
    expect(todaySession?.status).toBe("completed");
  });

  it("marks today's much shorter activity as partial", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(makePlan("2026-10-21"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.activities = [
      {
        id: 43,
        name: "Short jog",
        type: "running",
        startDate: "2026-10-21T06:30:00Z",
        distance: 2000,
        movingTime: 600,
        elapsedTime: 600,
        totalElevationGain: 0,
        sampleCount: 0,
        analysis: null,
        analysisError: null,
        programAnalysis: null,
        comment: null,
        coachReply: null,
      },
    ];
    context.activitiesUpdatedAt = new Date("2026-10-21T09:00:00Z");

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    const todaySession = saved?.plan.week.sessions.find(
      (session) => session.date === "2026-10-21",
    );
    expect(saved?.plan.today.status).toBe("partial");
    expect(todaySession?.status).toBe("partial");
  });

  it("fills a missing week and then today", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-26", {
        week: makeWeek("2026-10-26"),
      }),
    });
    const existing = makeStoredPlan(makePlan("2026-10-21"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-26",
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.week.startDate).toBe("2026-10-26");
    expect(saved?.plan.today.date).toBe("2026-10-26");
  });

  it("fills a missing block, then the week and today", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-12-02", {
        season: makeSeason(),
        block: makeBlock("2026-12-02", "2027-01-15"),
        week: makeWeek("2026-11-30"),
        today: makeDay("2026-12-02"),
      }),
    });
    const existing = makeStoredPlan(makePlan("2026-10-21"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-12-02",
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.block.startDate).toBe("2026-12-02");
    expect(saved?.plan.today.date).toBe("2026-12-02");
  });

  it("rejects a generated plan that is for the wrong date", async () => {
    const provider = new FakeProvider({
      season: JSON.stringify({ season: makeSeason() }),
      block: JSON.stringify({ block: makeBlock() }),
      weekly: JSON.stringify({
        week: makeWeek("2026-10-19"),
        block: makeBlock(),
      }),
      daily: JSON.stringify({
        today: makeDay("2026-10-20"),
        week: makeWeek("2026-10-19"),
      }),
    });
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();

    let failure: unknown;
    try {
      await runPlanGeneration({
        userId: 1,
        today: "2026-10-21",
        plan: null,
        context: makeContext(provider),
        plans,
        generations,
      });
    } catch (err) {
      failure = err;
    }

    expect((failure as Error).message).toContain("wrong date");
    expect(generations.status.status).toBe("error");
  });

  it("reviews recent activities after a full plan build", async () => {
    const provider = new FakeProvider(buildResponses());
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();
    const reviewed: { plan: CoachPlan | null } = { plan: null };

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: null,
      context: makeContext(provider),
      plans,
      generations,
      reviewActivities: (plan) => {
        reviewed.plan = plan;
        return Promise.resolve();
      },
    });

    expect(reviewed.plan).toEqual(saved?.plan ?? null);
    expect(generations.status.status).toBe("done");
  });

  it("does not review activities on a day-only cascade", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(makePlan("2026-10-20"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    let reviews = 0;

    await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
      reviewActivities: () => {
        reviews += 1;
        return Promise.resolve();
      },
    });

    expect(reviews).toBe(0);
  });

  it("keeps today's workout while revising the week and tomorrow", async () => {
    const current = makePlan("2026-10-21");
    const storedToday = {
      ...makeDay("2026-10-21"),
      title: "Athlete's session",
    };
    const storedWeek = makeWeek("2026-10-19");
    const stored = makeStoredPlan(
      {
        ...current,
        today: storedToday,
        week: {
          ...storedWeek,
          sessions: storedWeek.sessions.map((session) =>
            session.date === "2026-10-21"
              ? { ...session, title: "Athlete's session" }
              : session,
          ),
        },
      },
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-20T10:00:00Z"),
    );
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21", {
        tomorrow: makeDay("2026-10-22"),
      }),
    });
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: stored,
      keepToday: true,
      includeTomorrow: true,
      context: makeContext(
        provider,
        new Date("2026-10-20T10:00:00Z"),
        new Date("2026-10-21T10:00:00Z"),
      ),
      plans,
      generations,
    });

    const todaySession = saved?.plan.week.sessions.find(
      (session) => session.date === "2026-10-21",
    );
    expect(saved?.plan.today.title).toBe("Athlete's session");
    expect(todaySession?.title).toBe("Athlete's session");
    expect(saved?.plan.tomorrow?.date).toBe("2026-10-22");
  });

  it("refreshes today's completed summary when an activity was recorded today", async () => {
    const current = makePlan("2026-10-21");
    const storedToday = {
      ...makeDay("2026-10-21"),
      title: "Stale completed strength session",
      description: "Completed: stale summary with extra cardio.",
    };
    const storedWeek = makeWeek("2026-10-19");
    const stored = makeStoredPlan(
      {
        ...current,
        today: storedToday,
        week: {
          ...storedWeek,
          sessions: storedWeek.sessions.map((session) =>
            session.date === "2026-10-21"
              ? { ...session, title: "Stale completed strength session" }
              : session,
          ),
        },
      },
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-20T10:00:00Z"),
    );
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21", {
        today: {
          ...makeDay("2026-10-21"),
          title: "Strength training",
          description: "Completed: corrected strength summary.",
        },
        tomorrow: makeDay("2026-10-22"),
      }),
    });
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();
    const context = makeContext(
      provider,
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-21T10:00:00Z"),
    );
    context.activities = [
      {
        id: 42,
        name: "Strength training",
        type: "cardio",
        startDate: "2026-10-21T17:00:00Z",
        distance: 0,
        movingTime: 2400,
        elapsedTime: 2400,
        totalElevationGain: 0,
        sampleCount: 0,
        analysis: null,
        analysisError: null,
        programAnalysis: null,
        comment: "This is the gym session.",
        coachReply: null,
      },
    ];
    context.activityComments = [
      { activityId: "42", comment: "This is the gym session." },
    ];

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: stored,
      keepToday: true,
      context,
      plans,
      generations,
    });

    expect(saved?.plan.today.description).toBe(
      "Completed: corrected strength summary.",
    );
  });

  it("attaches the supplied forecast to the saved plan", async () => {
    const provider = new FakeProvider(buildResponses());
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.forecast = [
      {
        date: "2026-10-21",
        icon: "rain",
        temperatureMaxC: 9,
        temperatureMinC: 5,
        windMaxMs: 4,
        gustMaxMs: 8,
        precipitationMm: 2,
      },
    ];

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: null,
      context,
      plans,
      generations,
    });

    expect(saved?.plan.today.weather?.icon).toBe("rain");
    expect(saved?.plan.week.sessions[2]?.weather?.windMaxMs).toBe(4);
  });

  it("revises the week and day when the forecast changes significantly", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(
      withWeather(makePlan("2026-10-21"), weekForecast("sun")),
    );
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.forecast = weekForecast("rain");

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.week.sessions[0]?.weather?.icon).toBe("rain");

    // The saved plan now carries the new forecast, so the next visit does not
    // start another generation for the same change.
    const again = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: saved,
      context,
      plans,
      generations,
    });
    expect(provider.calls).toEqual(["plan-update"]);
    expect(again).toBe(saved);
  });

  it("does not revise when the forecast change is not significant", async () => {
    const provider = new FakeProvider({});
    const existing = makeStoredPlan(
      withWeather(makePlan("2026-10-21"), weekForecast("sun")),
    );
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.forecast = weekForecast("partly_cloudy");

    const saved = await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
    expect(saved).toBe(existing);
  });

  it("records a failed generation", async () => {
    const provider = new FakeProvider({});
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();

    let failure: unknown;
    try {
      await runPlanGeneration({
        userId: 1,
        today: "2026-10-21",
        plan: null,
        context: makeContext(provider),
        plans,
        generations,
      });
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("no response configured");
    expect(generations.status.status).toBe("error");
    expect(generations.status.error).toBe("no response configured");
  });

  it("generates next week and tomorrow when tomorrow crosses into a new week", async () => {
    const today = "2026-10-25";
    const currentWeek = makeEndedWeek("2026-10-19", today);
    const stored = makeStoredPlan({
      ...makePlan(today),
      week: currentWeek,
      tomorrow: null,
      nextWeek: null,
      nextBlock: null,
    });
    const nextWeek = makeWeek("2026-10-26");
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        nextWeek,
        tomorrow: makeDay("2026-10-26"),
      }),
    });
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      plan: stored,
      includeTomorrow: true,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.week.startDate).toBe(currentWeek.startDate);
    expect(saved?.plan.week.sessions.map((session) => session.date)).toEqual(
      currentWeek.sessions.map((session) => session.date),
    );
    expect(saved?.plan.week.sessions.map((session) => session.title)).toEqual(
      currentWeek.sessions.map((session) => session.title),
    );
    expect(saved?.plan.nextWeek?.startDate).toBe("2026-10-26");
    expect(saved?.plan.nextBlock).toBeNull();
    expect(saved?.plan.tomorrow?.date).toBe("2026-10-26");
    const monday = saved?.plan.nextWeek?.sessions.find(
      (session) => session.date === "2026-10-26",
    );
    expect(monday?.title).toBe(saved?.plan.tomorrow?.title);
    expect(monday?.description).toBe(saved?.plan.tomorrow?.description);
    expect(monday?.durationMinutes).toBe(saved?.plan.tomorrow?.durationMinutes);
  });

  it("recovers from an uncovered stored tomorrow by planning next week", async () => {
    const today = "2026-10-25";
    const stored = makeStoredPlan({
      ...makePlan(today),
      week: makeEndedWeek("2026-10-19", today),
      tomorrow: makeDay("2026-10-26"),
      nextWeek: null,
      nextBlock: null,
    });
    const nextWeek = makeWeek("2026-10-26");
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        nextWeek,
        tomorrow: makeDay("2026-10-26"),
      }),
    });
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      plan: stored,
      includeTomorrow: true,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.nextWeek?.startDate).toBe("2026-10-26");
    expect(saved?.plan.tomorrow?.date).toBe("2026-10-26");
    expect(planPending(saved!.plan, today, true).tomorrow).toBe(false);
    expect(generations.status.status).toBe("done");
  });

  it("generates the next block before the next week when tomorrow crosses both", async () => {
    const today = "2026-10-25";
    const currentBlock = makeBlock("2026-10-01", "2026-10-25");
    const stored = makeStoredPlan({
      ...makePlan(today),
      block: currentBlock,
      week: makeEndedWeek("2026-10-19", today),
    });
    const nextBlock = makeBlock("2026-10-26", "2026-12-06");
    const nextWeek = makeWeek("2026-10-26");
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        block: currentBlock,
        week: makeEndedWeek("2026-10-19", today),
        season: makeSeason(),
        nextBlock,
        nextWeek,
        tomorrow: makeDay("2026-10-26"),
      }),
    });
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      plan: stored,
      includeTomorrow: true,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.block.name).toBe(currentBlock.name);
    expect(saved?.plan.block.startDate).toBe(currentBlock.startDate);
    expect(saved?.plan.block.weeks.map((week) => week.startDate)).toEqual(
      currentBlock.weeks.map((week) => week.startDate),
    );
    expect(saved?.plan.nextBlock?.startDate).toBe("2026-10-26");
    expect(saved?.plan.nextWeek?.startDate).toBe("2026-10-26");
    expect(saved?.plan.tomorrow?.date).toBe("2026-10-26");
    expect(
      saved?.plan.nextWeek?.sessions.some(
        (session) => session.date === "2026-10-26",
      ),
    ).toBe(true);
  });

  it("drops an uncovered tomorrow when a revision does not ask for it", async () => {
    const today = "2026-10-25";
    const stored = makeStoredPlan(
      {
        ...makePlan(today),
        week: makeEndedWeek("2026-10-19", today),
      },
      new Date("2026-10-25T10:00:00Z"),
      new Date("2026-10-25T10:00:00Z"),
    );
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        nextWeek: makeWeek("2026-10-26"),
        tomorrow: makeDay("2026-10-26"),
      }),
    });
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      plan: stored,
      context: makeContext(
        provider,
        new Date("2026-10-25T10:00:00Z"),
        new Date("2026-10-25T12:00:00Z"),
      ),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.tomorrow).toBeNull();
    expect(saved?.plan.nextWeek).toBeNull();
  });

  it("reuses an already planned next week and tomorrow", async () => {
    const today = "2026-10-25";
    const nextWeek = makeWeek("2026-10-26");
    const stored = makeStoredPlan({
      ...makePlan(today),
      week: makeEndedWeek("2026-10-19", today),
      tomorrow: makeDay("2026-10-26"),
      nextWeek,
    });
    const provider = new FakeProvider({});
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      plan: stored,
      includeTomorrow: true,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
    expect(saved).toBe(stored);
    expect(generations.status.status).toBe("done");
  });

  it("promotes the stored next week and block when the date reaches them", async () => {
    const today = "2026-10-26";
    const currentWeek = makeEndedWeek("2026-10-19", "2026-10-25");
    const nextWeek = makeWeek("2026-10-26");
    const tomorrow = makeDay("2026-10-26");
    const currentBlock = makeBlock("2026-10-01", "2026-10-25");
    const nextBlock = makeBlock("2026-10-26", "2026-12-06");
    const stored = makeStoredPlan(
      {
        ...makePlan("2026-10-25"),
        block: currentBlock,
        week: currentWeek,
        today: makeDay("2026-10-25"),
        tomorrow,
        nextWeek,
        nextBlock,
      },
      new Date("2026-10-25T10:00:00Z"),
    );
    const provider = new FakeProvider({});
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();
    const reviewedWeeks: string[] = [];

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      plan: stored,
      context: makeContext(provider, new Date("2026-10-25T10:00:00Z")),
      plans,
      generations,
      capturePeriodReviews: (input) => {
        reviewedWeeks.push(input.plan.week.startDate);
        return Promise.resolve();
      },
    });

    expect(provider.calls).toEqual([]);
    expect(reviewedWeeks).toEqual(["2026-10-19"]);
    expect(saved?.plan.week.startDate).toBe("2026-10-26");
    expect(saved?.plan.nextWeek).toBeNull();
    expect(saved?.plan.block.startDate).toBe("2026-10-26");
    expect(saved?.plan.nextBlock).toBeNull();
    expect(saved?.plan.today.date).toBe("2026-10-26");
    expect(saved?.plan.today.title).toBe(tomorrow.title);
    expect(saved?.plan.tomorrow).toBeNull();
  });

  it("builds a fresh season from today when asked for a new season", async () => {
    const today = "2026-11-15";
    const provider = new FakeProvider({
      season: JSON.stringify({ season: makeRefreshedSeason(today) }),
      block: JSON.stringify({ block: makeBlock(today, "2026-12-31") }),
      weekly: JSON.stringify({
        week: makeWeek(startOfWeek(today)),
        block: makeBlock(today, "2026-12-31"),
      }),
      daily: JSON.stringify({
        today: makeDay(today),
        week: makeWeek(startOfWeek(today)),
      }),
    });
    const existing = makeStoredPlan(makeMidSeasonPlan(today));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      mode: "newSeason",
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["season", "block", "weekly", "daily"]);
    expect(saved?.plan.season.startDate).toBe(today);
    expect(saved?.plan.season.blocks[0]?.name).toBe("Rebuild");
    expect(saved?.plan.block.startDate).toBe(today);
  });

  it("refreshes the current block in place and keeps completed blocks", async () => {
    const today = "2026-11-15";
    const previous = makeMidSeasonPlan(today);
    const completed = previous.season.blocks[0];
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        season: makeRefreshedSeason("2026-11-01"),
        block: makeBlock("2026-11-01", "2026-12-31"),
        week: makeWeek(startOfWeek(today)),
        today: makeDay(today),
      }),
    });
    const existing = makeStoredPlan(previous);
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      today,
      mode: "updateSeason",
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.season.startDate).toBe("2026-10-01");
    expect(saved?.plan.season.blocks[0]).toEqual(completed);
    expect(saved?.plan.season.blocks[1]?.startDate).toBe("2026-11-01");
    expect(saved?.plan.season.blocks[1]?.name).toBe("Rebuild");
    expect(saved?.plan.block.startDate).toBe("2026-11-01");
    expect(saved?.plan.today.date).toBe(today);
    expect(generations.steps).toContain("Refreshing your season");
  });

  it("refreshes an existing season automatically when answers are stale", async () => {
    const today = "2026-11-15";
    const previous = makeMidSeasonPlan(today);
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        season: makeRefreshedSeason("2026-11-01"),
        block: makeBlock("2026-11-01", "2026-12-31"),
        week: makeWeek(startOfWeek(today)),
        today: makeDay(today),
      }),
    });
    const existing = makeStoredPlan(previous, new Date("2026-11-01T10:00:00Z"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    await runPlanGeneration({
      userId: 1,
      today,
      plan: existing,
      context: makeContext(provider, new Date("2026-11-15T10:00:00Z")),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
  });

  it("falls back to a new season when update mode has no season to refresh", async () => {
    const provider = new FakeProvider(buildResponses());
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();

    await runPlanGeneration({
      userId: 1,
      today: "2026-10-21",
      mode: "updateSeason",
      plan: null,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["season", "block", "weekly", "daily"]);
  });

  it("rejects a refreshed season that moves the current block start date", async () => {
    const today = "2026-11-15";
    const previous = makeMidSeasonPlan(today);
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        season: makeRefreshedSeason(today),
        block: makeBlock(today, "2026-12-31"),
        week: makeWeek(startOfWeek(today)),
        today: makeDay(today),
      }),
    });
    const existing = makeStoredPlan(previous);
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    let failure: unknown;
    try {
      await runPlanGeneration({
        userId: 1,
        today,
        mode: "updateSeason",
        plan: existing,
        context: makeContext(provider),
        plans,
        generations,
      });
    } catch (err) {
      failure = err;
    }

    expect((failure as Error).message).toContain("refresh");
    expect(generations.status.status).toBe("error");
    expect(plans.saved).toBe(existing);
  });

  it("rejects a block revision that moves the current block start date", async () => {
    const today = "2026-11-15";
    const previous = makeMidSeasonPlan(today);
    const ended = {
      ...previous,
      block: { ...previous.block, endDate: "2026-11-14" },
    };
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        block: makeBlock("2026-11-16", "2026-12-31"),
        week: makeWeek(startOfWeek(today)),
        today: makeDay(today),
      }),
    });
    const existing = makeStoredPlan(ended);
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    let failure: unknown;
    try {
      await runPlanGeneration({
        userId: 1,
        today,
        plan: existing,
        context: makeContext(provider),
        plans,
        generations,
      });
    } catch (err) {
      failure = err;
    }

    expect((failure as Error).message).toContain("start date");
    expect(generations.status.status).toBe("error");
    expect(plans.saved).toBe(existing);
  });
});
