import { describe, expect, it } from "bun:test";
import { makeAnalyzedActivity } from "../../testFixtures/plan.js";
import {
  buildResponses,
  FakeProvider,
  makeBlock,
  makeContext,
  makeDay,
  makeEndedWeek,
  makePlan,
  makeStoredPlan,
  makeUpdate,
  makeWeek,
  MemoryGenerationStore,
  MemoryPlanStore,
  weekForecast,
  withWeather,
} from "../../testFixtures/generationHarness.js";
import { runPlanGeneration } from "../generate.js";

describe("runPlanGeneration", () => {
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
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context: makeContext(provider, new Date("2026-10-21T10:00:00Z")),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(generations.status.status).toBe("done");
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
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
    expect(saved).toBe(existing);
  });

  it("records a new analysis that judged the plan unchanged without revising it", async () => {
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
    context.activitiesUpdatedAt = new Date("2026-10-21T09:00:00Z");
    context.activitiesRefreshUpdatedAt = null;

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
    // The plan keeps its training content but records the analysis it read.
    expect(saved).not.toBe(existing);
    expect(saved?.activitiesUpdatedAt).toEqual(
      new Date("2026-10-21T09:00:00Z"),
    );
  });

  it("settles today's completion for an analysis that needs no plan change", async () => {
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
    context.activities = [
      makeAnalyzedActivity({
        startDate: "2026-10-21T07:00:00Z",
        elapsedTime: 2700,
        analysis: {
          text: "The planned easy run, done.",
          model: "test-model",
          generatedAt: "2026-10-21T09:00:00Z",
          planChangeNeeded: false,
        },
      }),
    ];
    context.activitiesUpdatedAt = new Date("2026-10-21T09:00:00Z");
    context.activitiesRefreshUpdatedAt = null;

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
    expect(saved?.plan.today.status).toBe("completed");
    expect(
      saved?.plan.week.sessions.find((session) => session.date === "2026-10-21")
        ?.status,
    ).toBe("completed");
    expect(saved?.activitiesUpdatedAt).toEqual(
      new Date("2026-10-21T09:00:00Z"),
    );
  });

  it("revises when a new analysis judged the plan changed", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(
      makePlan("2026-10-21"),
      new Date("2026-10-20T10:00:00Z"),
      null,
      new Date("2026-10-20T09:00:00Z"),
    );
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(provider);
    context.activitiesUpdatedAt = new Date("2026-10-21T09:00:00Z");
    context.activitiesRefreshUpdatedAt = new Date("2026-10-21T09:00:00Z");

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
  });

  it("records a coaching input that judged the plan unchanged without revising it", async () => {
    const provider = new FakeProvider({});
    const existing = makeStoredPlan(
      makePlan("2026-10-21"),
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-20T10:00:00Z"),
    );
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(
      provider,
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-21T10:00:00Z"),
    );
    context.coachingInputsRefreshUpdatedAt = null;

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
    expect(saved).not.toBe(existing);
    expect(saved?.coachingInputsUpdatedAt).toEqual(
      new Date("2026-10-21T10:00:00Z"),
    );
  });

  it("does not revise for a week review that judged the block unchanged", async () => {
    const provider = new FakeProvider({});
    const existing = makeStoredPlan(
      makePlan("2026-10-21"),
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-20T10:00:00Z"),
    );
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();
    const context = makeContext(
      provider,
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-21T10:00:00Z"),
    );
    context.coachingInputsRefreshUpdatedAt = null;
    context.weekReviewUpdatedAt = new Date("2026-10-21T10:00:00Z");
    context.weekReviewNeedsRefresh = false;

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
  });

  it("revises the block in place for a week review that asks for a change", async () => {
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
    const context = makeContext(
      provider,
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-21T10:00:00Z"),
    );
    context.coachingInputsRefreshUpdatedAt = new Date("2026-10-21T10:00:00Z");
    context.weekReviewUpdatedAt = new Date("2026-10-21T10:00:00Z");
    context.weekReviewNeedsRefresh = true;

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
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
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
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
      runId: "run-1",
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
      runId: "run-1",
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
      runId: "run-1",
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
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual([]);
    expect(saved).toBe(existing);
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
      runId: "run-1",
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
});
