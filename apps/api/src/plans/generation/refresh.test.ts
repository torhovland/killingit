import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import { startOfWeek } from "@killingit/shared";
import {
  FakeProvider,
  makeBlock,
  makeContext,
  makeDay,
  makeGappedRefreshedSeason,
  makeMidSeasonPlan,
  makeOverlappingSeason,
  makePlan,
  makeRefreshedSeason,
  makeStoredPlan,
  makeUpdate,
  makeWeek,
  MemoryGenerationStore,
  MemoryPlanStore,
} from "../../testFixtures/generationHarness.js";
import { runPlanGeneration } from "../generate.js";

describe("runPlanGeneration", () => {
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
      runId: "run-1",
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

  it("keeps the stored introduction when the season is refreshed", async () => {
    const today = "2026-11-15";
    const base = makeMidSeasonPlan(today);
    const introduction =
      "Hello Alex, I'm your coach. I'm looking forward to working with you.";
    const previous: CoachPlan = {
      ...base,
      season: { ...base.season, introduction },
    };
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
      runId: "run-1",
      today,
      mode: "updateSeason",
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(saved?.plan.season.introduction).toBe(introduction);
  });

  it("refreshes the season when a block review is generated", async () => {
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
    const existing = makeStoredPlan(previous);
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today,
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
      capturePeriodReviews: () =>
        Promise.resolve([
          {
            kind: "block" as const,
            title: "Build",
            startDate: "2026-11-01",
            endDate: "2026-11-14",
            summary: "The block was consistent and the threshold work landed.",
            comment: null,
            reply: null,
            updatedAt: new Date().toISOString(),
          },
        ]),
    });

    expect(provider.calls).toEqual(["plan-update"]);
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
      runId: "run-1",
      today,
      plan: existing,
      context: makeContext(provider, new Date("2026-11-15T10:00:00Z")),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
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
        runId: "run-1",
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
        runId: "run-1",
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

  it("rejects a block revision that returns overlapping season blocks", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21", {
        season: makeOverlappingSeason(),
        block: makeBlock(),
      }),
    });
    const existing = makeStoredPlan(
      makePlan("2026-10-21"),
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-20T10:00:00Z"),
    );
    const context = makeContext(
      provider,
      new Date("2026-10-20T10:00:00Z"),
      new Date("2026-10-21T10:00:00Z"),
    );
    context.weekReviewUpdatedAt = new Date("2026-10-21T10:00:00Z");
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    let failure: unknown;
    try {
      await runPlanGeneration({
        userId: 1,
        runId: "run-1",
        today: "2026-10-21",
        plan: existing,
        context,
        plans,
        generations,
      });
    } catch (err) {
      failure = err;
    }

    expect((failure as Error).message).toContain("overlapping season blocks");
    expect(generations.status.status).toBe("error");
    expect(plans.saved).toBe(existing);
  });

  it("rejects a season refresh that leaves a day unplanned between blocks", async () => {
    const today = "2026-11-15";
    const previous = makeMidSeasonPlan(today);
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        season: makeGappedRefreshedSeason("2026-11-01"),
        block: makeBlock("2026-11-01", "2026-12-31"),
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
        runId: "run-1",
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

    expect((failure as Error).message).toBe(
      'The coach returned a gap between season blocks: "Rebuild" ends on 2026-12-31 and "Peak" starts on 2027-01-02, leaving 2027-01-01 unplanned. Please regenerate the plan.',
    );
    expect(generations.status.status).toBe("error");
    expect(plans.saved).toBe(existing);
  });

  it("rejects a season refresh whose blocks share a day", async () => {
    const today = "2026-11-15";
    const previous = makeMidSeasonPlan(today);
    const refreshed = makeRefreshedSeason("2026-11-01");
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        season: {
          ...refreshed,
          blocks: [
            {
              ...refreshed.blocks[0]!,
              name: "Rebuild",
              endDate: "2026-12-31",
            },
            { ...refreshed.blocks[1]!, name: "Peak", startDate: "2026-12-31" },
          ],
        },
        block: makeBlock("2026-11-01", "2026-12-31"),
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
        runId: "run-1",
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

    expect((failure as Error).message).toBe(
      'The coach returned overlapping season blocks: "Peak" starts on 2026-12-31, the day "Rebuild" ends. Please regenerate the plan.',
    );
    expect(plans.saved).toBe(existing);
  });

  it("does not re-check boundaries between blocks that already ended", async () => {
    const today = "2026-11-15";
    const previous = makeMidSeasonPlan(today);
    const ended: CoachPlan = {
      ...previous,
      season: {
        ...previous.season,
        blocks: [
          previous.season.blocks[0]!,
          {
            ...previous.season.blocks[0]!,
            name: "Repeat base",
            startDate: "2026-10-20",
          },
          previous.season.blocks[1]!,
        ],
      },
      today: makeDay("2026-11-14"),
    };
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        week: makeWeek("2026-11-09"),
        today: makeDay(today),
      }),
    });
    const existing = makeStoredPlan(ended);
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today,
      plan: existing,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.today.date).toBe(today);
    expect(saved?.plan.season.blocks).toHaveLength(3);
  });
});
