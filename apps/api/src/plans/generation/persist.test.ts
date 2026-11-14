import { describe, expect, it } from "bun:test";
import { startOfWeek } from "@killingit/shared";
import {
  buildResponses,
  FakeProvider,
  makeContext,
  makeDay,
  makePlan,
  makeSeason,
  makeStoredPlan,
  makeUpdate,
  makeWeek,
  MemoryGenerationStore,
  MemoryPlanStore,
} from "../../testFixtures/generationHarness.js";
import { runPlanGeneration } from "../generate.js";

describe("runPlanGeneration", () => {
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
      runId: "run-1",
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
      runId: "run-1",
      today: "2026-10-21",
      plan: null,
      context: makeContext(provider),
      plans: new MemoryPlanStore(null),
      generations: new MemoryGenerationStore(),
      recordBodyMetrics: () => Promise.reject(new Error("database down")),
    });

    expect(saved?.plan.today.date).toBe("2026-10-21");
  });

  it("clears pending coach questions before building a new season", async () => {
    const provider = new FakeProvider(buildResponses());
    let cleared = 0;

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: null,
      context: makeContext(provider),
      plans: new MemoryPlanStore(null),
      generations: new MemoryGenerationStore(),
      clearCoachQuestions: () => {
        cleared += 1;
        return Promise.resolve();
      },
    });

    expect(provider.calls).toEqual(["season", "block", "weekly", "daily"]);
    expect(cleared).toBe(1);
  });

  it("clears pending coach questions before a season refresh", async () => {
    const provider = new FakeProvider(buildResponses());
    const existing = makeStoredPlan(
      makePlan(),
      new Date("2026-10-19T10:00:00Z"),
    );
    let cleared = 0;

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context: makeContext(provider, new Date("2026-10-21T10:00:00Z")),
      plans: new MemoryPlanStore(existing),
      generations: new MemoryGenerationStore(),
      clearCoachQuestions: () => {
        cleared += 1;
        return Promise.resolve();
      },
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(cleared).toBe(1);
  });

  it("keeps pending coach questions when only the day changes", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(makePlan("2026-10-20"));
    let cleared = 0;

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context: makeContext(provider),
      plans: new MemoryPlanStore(existing),
      generations: new MemoryGenerationStore(),
      clearCoachQuestions: () => {
        cleared += 1;
        return Promise.resolve();
      },
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(cleared).toBe(0);
  });

  it("still builds the season when pending questions cannot be cleared", async () => {
    const provider = new FakeProvider(buildResponses());

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: null,
      context: makeContext(provider),
      plans: new MemoryPlanStore(null),
      generations: new MemoryGenerationStore(),
      clearCoachQuestions: () => Promise.reject(new Error("database down")),
    });

    expect(provider.calls).toEqual(["season", "block", "weekly", "daily"]);
    expect(saved?.plan.today.date).toBe("2026-10-21");
  });

  it("clears survey adjustments after a successful stale season refresh", async () => {
    const provider = new FakeProvider(buildResponses());
    const existing = makeStoredPlan(
      makePlan(),
      new Date("2026-10-19T10:00:00Z"),
    );
    let cleared = 0;

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context: {
        ...makeContext(provider, new Date("2026-10-21T10:00:00Z")),
        coachingSurveyAdjustments: [
          {
            question: "How many hours can you train each week?",
            previousQuestion: null,
            previousAnswer: null,
            answer: "About nine.",
          },
        ],
      },
      plans: new MemoryPlanStore(existing),
      generations: new MemoryGenerationStore(),
      clearCoachingSurveyAdjustments: () => {
        cleared += 1;
        return Promise.resolve();
      },
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(cleared).toBe(1);
  });

  it("keeps survey adjustments when the season refresh fails", async () => {
    const provider = new FakeProvider({});
    const existing = makeStoredPlan(
      makePlan(),
      new Date("2026-10-19T10:00:00Z"),
    );
    let cleared = 0;

    let failure: unknown;

    try {
      await runPlanGeneration({
        userId: 1,
        runId: "run-1",
        today: "2026-10-21",
        plan: existing,
        context: {
          ...makeContext(provider, new Date("2026-10-21T10:00:00Z")),
          coachingSurveyAdjustments: [
            {
              question: "How many hours can you train each week?",
              previousQuestion: null,
              previousAnswer: null,
              answer: "About nine.",
            },
          ],
        },
        plans: new MemoryPlanStore(existing),
        generations: new MemoryGenerationStore(),
        clearCoachingSurveyAdjustments: () => {
          cleared += 1;
          return Promise.resolve();
        },
      });
    } catch (err: unknown) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("no response configured");
    expect(cleared).toBe(0);
  });
});
