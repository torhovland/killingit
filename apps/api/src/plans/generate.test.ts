import { describe, expect, it } from "bun:test";
import { startOfWeek } from "@killingit/shared";
import {
  buildResponses,
  FakeProvider,
  makeBikeWeek,
  makeBlock,
  makeContext,
  makeDay,
  makeSeason,
  makeWeek,
  MemoryGenerationStore,
  MemoryPlanStore,
} from "../testFixtures/generationHarness.js";
import { PLAN_FAILED_MESSAGE } from "./failure.js";
import { runPlanGeneration } from "./generate.js";

describe("runPlanGeneration", () => {
  it("builds all four levels in sequential steps when there is no plan", async () => {
    const provider = new FakeProvider(buildResponses());
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
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

  it("uses the season model for season and block prompts and the daily model for week and day", async () => {
    const provider = new FakeProvider(buildResponses());
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();

    await runPlanGeneration({
      userId: 1,
      runId: "run-models",
      today: "2026-10-21",
      plan: null,
      context: {
        ...makeContext(provider),
        seasonModel: "season-model",
        dailyModel: "daily-model",
      },
      plans,
      generations,
    });

    expect(provider.models).toEqual([
      "season-model",
      "season-model",
      "daily-model",
      "daily-model",
    ]);
  });

  it("keeps detailed workouts only in the day plans", async () => {
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
      runId: "run-1",
      today,
      plan: null,
      context: makeContext(provider),
      plans: new MemoryPlanStore(null),
      generations: new MemoryGenerationStore(),
    });

    const sessions = saved?.plan.week.sessions ?? [];
    expect(sessions.every((session) => session.bikeWorkout == null)).toBe(true);
    expect(saved?.plan.today.bikeWorkout).toEqual(bikeWorkout);
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
    const marked: { userId: number; since: Date; error: string }[] = [];

    let failure: unknown;
    try {
      await runPlanGeneration({
        userId: 1,
        runId: "run-1",
        today: "2026-10-21",
        plan: null,
        context: makeContext(provider),
        plans,
        generations,
        markPromptsFailed: (userId, since, error) => {
          marked.push({ userId, since, error });
          return Promise.resolve();
        },
      });
    } catch (err) {
      failure = err;
    }

    expect((failure as Error).message).toContain("wrong date");
    expect(generations.status.status).toBe("error");
    // The athlete sees a generic reason; the raw detail stays in the prompt log
    // for the admin. See ADR 0038.
    expect(generations.status.error).toBe(PLAN_FAILED_MESSAGE);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.userId).toBe(1);
    expect(marked[0]?.error).toContain("wrong date");
  });

  it("records a failed generation", async () => {
    const provider = new FakeProvider({});
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();

    let failure: unknown;
    try {
      await runPlanGeneration({
        userId: 1,
        runId: "run-1",
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
    expect(generations.status.error).toBe(PLAN_FAILED_MESSAGE);
    expect(generations.status.error).not.toContain("no response configured");
  });

  it("stops without saving or failing when a newer run took over", async () => {
    const provider = new FakeProvider(buildResponses());
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();
    generations.isCurrent = () => Promise.resolve(false);

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "superseded-run",
      today: "2026-10-21",
      plan: null,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(saved).toBeNull();
    expect(provider.calls).toEqual([]);
    expect(plans.saved).toBeNull();
    expect(generations.status.status).toBe("idle");
  });
});
