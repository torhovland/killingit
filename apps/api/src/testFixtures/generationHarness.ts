import type {
  BlockPlan,
  CoachPlan,
  DailyWeather,
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
import { startOfWeek } from "@killingit/shared";
import {
  makeBlock as makeFixtureBlock,
  makeDay,
  makePlan as makeFixturePlan,
  makeSeason,
  makeWeek,
} from "./plan.js";
import type { PlanGenerationContext } from "../plans/generation/types.js";

export { makeDay, makeSeason, makeWeek } from "./plan.js";
import type { PlanGenerationStep } from "../plans/steps.js";
import {
  idleGenerationStatus,
  type PlanGenerationStore,
  type PlanSaveInput,
  type PlanStore,
  type StoredPlan,
} from "../plans/store.js";

/** The fixture plan with a specific concrete day. */
export function makePlan(today = "2026-10-21"): CoachPlan {
  return makeFixturePlan({ today: makeDay(today) });
}

/** The fixture block with the legacy positional date arguments. */
export function makeBlock(
  startDate = "2026-10-21",
  endDate = "2026-12-01",
): BlockPlan {
  return makeFixtureBlock({ startDate, endDate });
}

/** The same week with a structured workout on every day. */
export function makeBikeWeek(startDate: string): WeekPlan {
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
export function makeEndedWeek(startDate: string, today: string): WeekPlan {
  const week = makeWeek(startDate);
  return {
    ...week,
    sessions: week.sessions.map((session) =>
      session.date < today ? { ...session, status: "missed" } : session,
    ),
  };
}

/** A complete plan returned by the single plan-update prompt. */
export function makeUpdate(
  today = "2026-10-21",
  overrides: Partial<CoachPlan> = {},
): string {
  return JSON.stringify({ ...makePlan(today), ...overrides });
}

export function weekForecast(icon: DailyWeather["icon"]): DailyWeather[] {
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

export function withWeather(
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

export function buildResponses(today = "2026-10-21") {
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
export function makeRefreshedSeason(startDate = "2026-10-21"): SeasonPlan {
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

/** A season whose second block starts on the day the first block ends. */
export function makeOverlappingSeason(): SeasonPlan {
  return {
    ...makeSeason(),
    blocks: [
      {
        name: "Base",
        focus: "Aerobic endurance",
        startDate: "2026-10-21",
        endDate: "2026-12-01",
        weekCount: 6,
      },
      {
        name: "Build",
        focus: "Threshold and race pace",
        startDate: "2026-12-01",
        endDate: "2027-04-01",
        weekCount: 17,
      },
    ],
  };
}

/** A refreshed season that leaves the day after the current block unplanned. */
export function makeGappedRefreshedSeason(
  startDate = "2026-11-01",
): SeasonPlan {
  return {
    ...makeRefreshedSeason(startDate),
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
        startDate: "2027-01-02",
        endDate: "2027-04-01",
        weekCount: 13,
      },
    ],
  };
}

/** A stored plan in the middle of a season with one completed block. */
export function makeMidSeasonPlan(today = "2026-11-15"): CoachPlan {
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

export function makeStoredPlan(
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

export function makeContext(
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

export class MemoryPlanStore implements PlanStore {
  saved: StoredPlan | null;

  constructor(initial: StoredPlan | null) {
    this.saved = initial;
  }

  load(): Promise<StoredPlan | null> {
    return Promise.resolve(this.saved);
  }

  save({
    plan,
    answersUpdatedAt,
    coachingInputsUpdatedAt = null,
    activitiesUpdatedAt = null,
  }: PlanSaveInput): Promise<StoredPlan> {
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

export class MemoryGenerationStore implements PlanGenerationStore {
  status: PlanGenerationStatus = idleGenerationStatus();
  steps: string[] = [];

  load(): Promise<PlanGenerationStatus> {
    return Promise.resolve(this.status);
  }

  begin(_userId: number, runId: string): Promise<void> {
    this.status = {
      ...this.status,
      status: "running",
      runId,
      step: "Preparing your plan",
      progress: 5,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }

  isCurrent(_userId: number, runId: string): Promise<boolean> {
    return Promise.resolve(
      this.status.runId === runId || this.status.runId === null,
    );
  }

  update(
    _userId: number,
    step: PlanGenerationStep,
    _runId: string,
  ): Promise<void> {
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

  fail(_userId: number, error: string): Promise<Date | null> {
    this.status = {
      ...this.status,
      status: "error",
      error,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve(new Date());
  }
}

export class FakeProvider implements LlmProvider {
  readonly id = "fake";
  calls: string[] = [];
  models: string[] = [];

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
    this.models.push(request.model);
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
