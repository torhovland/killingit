import { describe, expect, it } from "bun:test";
import type {
  BlockPlan,
  CoachPlan,
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
  BLOCK_UPDATE_SYSTEM_PROMPT,
  DAILY_UPDATE_SYSTEM_PROMPT,
  WEEKLY_UPDATE_SYSTEM_PROMPT,
} from "../llm/planUpdatePrompt.js";
import { addDays } from "./dates.js";
import { runPlanGeneration, type PlanGenerationContext } from "./generate.js";
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
  };
}

function makePlan(today = "2026-10-21"): CoachPlan {
  return {
    season: makeSeason(),
    block: makeBlock(),
    week: makeWeek("2026-10-19"),
    today: makeDay(today),
    tomorrow: null,
  };
}

function buildResponses(today = "2026-10-21") {
  return {
    season: JSON.stringify({ season: makeSeason() }),
    block: JSON.stringify({ block: makeBlock() }),
    weekly: JSON.stringify({
      week: makeWeek("2026-10-19"),
      block: makeBlock(),
    }),
    daily: JSON.stringify({
      today: makeDay(today),
      week: makeWeek("2026-10-19"),
    }),
  };
}

function makeStoredPlan(
  plan: CoachPlan,
  answersUpdatedAt: Date | null = new Date("2026-10-20T10:00:00Z"),
): StoredPlan {
  return {
    plan,
    answersUpdatedAt,
    generatedAt: new Date("2026-10-20T10:00:00Z"),
  };
}

function makeContext(
  provider: LlmProvider,
  answersUpdatedAt: Date | null = new Date("2026-10-20T10:00:00Z"),
): PlanGenerationContext {
  return {
    answers: [{ prompt: "Goal?", answer: "Marathon", skipped: false }],
    answersUpdatedAt,
    activities: [],
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
  ): Promise<StoredPlan> {
    this.saved = { plan, answersUpdatedAt, generatedAt: new Date() };
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

  update(_userId: number, step: string, progress: number): Promise<void> {
    this.steps.push(step);
    this.status = {
      ...this.status,
      status: "running",
      step,
      progress,
      updatedAt: new Date().toISOString(),
    };
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
      blockUpdate?: string;
      daily?: string;
      weekly?: string;
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
    if (system === BLOCK_UPDATE_SYSTEM_PROMPT) {
      this.calls.push("block-update");
      return this.respond(this.responses.blockUpdate);
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
    expect(generations.steps).toContain("Designing your first block");
    expect(generations.steps).toContain("Building your first week");
  });

  it("regenerates everything in steps when the answers are stale", async () => {
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

    expect(provider.calls).toEqual(["season", "block", "weekly", "daily"]);
    expect(generations.status.status).toBe("done");
  });

  it("fills a missing day and revises the week", async () => {
    const provider = new FakeProvider({
      daily: JSON.stringify({
        today: makeDay("2026-10-21"),
        week: makeWeek("2026-10-19"),
      }),
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

    expect(provider.calls).toEqual(["daily"]);
    expect(saved?.plan.today.date).toBe("2026-10-21");
    expect(generations.status.status).toBe("done");
  });

  it("fills a missing week and then today", async () => {
    const provider = new FakeProvider({
      weekly: JSON.stringify({
        week: makeWeek("2026-10-26"),
        block: makeBlock(),
      }),
      daily: JSON.stringify({
        today: makeDay("2026-10-26"),
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

    expect(provider.calls).toEqual(["weekly", "daily"]);
    expect(saved?.plan.week.startDate).toBe("2026-10-26");
    expect(saved?.plan.today.date).toBe("2026-10-26");
  });

  it("fills a missing block, then the week and today", async () => {
    const provider = new FakeProvider({
      blockUpdate: JSON.stringify({
        block: makeBlock("2026-12-02", "2027-01-15"),
        season: makeSeason(),
      }),
      weekly: JSON.stringify({
        week: makeWeek("2026-11-30"),
        block: makeBlock("2026-12-02", "2027-01-15"),
      }),
      daily: JSON.stringify({
        today: makeDay("2026-12-02"),
        week: makeWeek("2026-11-30"),
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

    expect(provider.calls).toEqual(["block-update", "weekly", "daily"]);
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
});
