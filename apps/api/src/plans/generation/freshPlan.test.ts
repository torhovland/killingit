import { describe, expect, it } from "bun:test";
import { startOfWeek } from "@killingit/shared";
import {
  buildResponses,
  FakeProvider,
  makeBlock,
  makeContext,
  makeDay,
  makeMidSeasonPlan,
  makeOverlappingSeason,
  makeRefreshedSeason,
  makeStoredPlan,
  makeWeek,
  MemoryGenerationStore,
  MemoryPlanStore,
} from "../../testFixtures/generationHarness.js";
import { runPlanGeneration } from "../generate.js";

describe("runPlanGeneration", () => {
  it("builds a fresh season from today when asked for a new season", async () => {
    const today = "2026-11-15";
    const provider = new FakeProvider({
      season: JSON.stringify({
        season: {
          ...makeRefreshedSeason(today),
          introduction:
            "Hello, I am your coach and I look forward to working with you.",
        },
      }),
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
      runId: "run-1",
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

  it("falls back to a new season when update mode has no season to refresh", async () => {
    const provider = new FakeProvider(buildResponses());
    const plans = new MemoryPlanStore(null);
    const generations = new MemoryGenerationStore();

    await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      mode: "updateSeason",
      plan: null,
      context: makeContext(provider),
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["season", "block", "weekly", "daily"]);
  });

  it("rejects a new season whose blocks share a day", async () => {
    const provider = new FakeProvider({
      ...buildResponses(),
      season: JSON.stringify({ season: makeOverlappingSeason() }),
    });
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

    expect((failure as Error).message).toBe(
      'The coach returned overlapping season blocks: "Build" starts on 2026-12-01, the day "Base" ends. Please regenerate the plan.',
    );
    expect(generations.status.status).toBe("error");
    expect(plans.saved).toBeNull();
  });
});
