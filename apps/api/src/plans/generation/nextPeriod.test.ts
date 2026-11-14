import { describe, expect, it } from "bun:test";
import {
  FakeProvider,
  makeBlock,
  makeContext,
  makeDay,
  makeEndedWeek,
  makePlan,
  makeSeason,
  makeStoredPlan,
  makeUpdate,
  makeWeek,
  MemoryGenerationStore,
  MemoryPlanStore,
} from "../../testFixtures/generationHarness.js";
import { runPlanGeneration } from "../generate.js";
import { planPending } from "../status.js";

describe("runPlanGeneration", () => {
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
      runId: "run-1",
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
    expect(monday?.title).toBe("Session 1");
    expect(monday?.description).toBe("Easy aerobic work.");
    expect(monday?.durationMinutes).toBe(45);
  });

  it("takes only tomorrow's outline from the coach's week", async () => {
    const today = "2026-10-21";
    const current = makePlan(today);
    const stored = makeStoredPlan({ ...current, tomorrow: null });
    const coachWeek = makeWeek("2026-10-19");
    const provider = new FakeProvider({
      planUpdate: makeUpdate(today, {
        tomorrow: makeDay("2026-10-22"),
        week: {
          ...coachWeek,
          sessions: coachWeek.sessions.map((session) =>
            session.date === "2026-10-22"
              ? {
                  ...session,
                  title: "Tomorrow outline",
                  description: "Short overview.",
                }
              : session,
          ),
        },
      }),
    });
    const plans = new MemoryPlanStore(stored);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
      today,
      plan: stored,
      includeTomorrow: true,
      context: makeContext(provider),
      plans,
      generations,
    });

    const tomorrowSession = saved?.plan.week.sessions.find(
      (session) => session.date === "2026-10-22",
    );
    const thursday = saved?.plan.week.sessions.find(
      (session) => session.date === "2026-10-23",
    );
    expect(saved?.plan.tomorrow?.title).toBe("Easy run");
    expect(tomorrowSession?.title).toBe("Tomorrow outline");
    expect(tomorrowSession?.description).toBe("Short overview.");
    expect(thursday?.title).toBe("Session 5");
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
      runId: "run-1",
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
    expect(
      planPending({ plan: saved!.plan, today, includeTomorrow: true }).tomorrow,
    ).toBe(false);
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
      runId: "run-1",
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
      runId: "run-1",
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
      runId: "run-1",
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
});
