import { describe, expect, it } from "bun:test";
import {
  FakeProvider,
  makeBlock,
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
import type { GeneratePlanInput } from "./types.js";

describe("runPlanGeneration", () => {
  it("fills a missing day and revises the week", async () => {
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21"),
    });
    const existing = makeStoredPlan(makePlan("2026-10-20"));
    const plans = new MemoryPlanStore(existing);
    const generations = new MemoryGenerationStore();

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
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
      runId: "run-1",
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

  it("revises the current block in place when a week review arrives", async () => {
    const revisedBlock = {
      ...makeBlock(),
      focus: "Aerobic endurance with more recovery",
    };
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21", { block: revisedBlock }),
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
    expect(saved?.plan.block.startDate).toBe("2026-10-21");
    expect(saved?.plan.block.focus).toBe(
      "Aerobic endurance with more recovery",
    );
  });

  it("uses a week review generated in the same run to revise the block", async () => {
    const revisedBlock = {
      ...makeBlock(),
      focus: "Aerobic endurance with a recovery week",
    };
    const provider = new FakeProvider({
      planUpdate: makeUpdate("2026-10-21", { block: revisedBlock }),
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
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context: makeContext(
        provider,
        new Date("2026-10-20T10:00:00Z"),
        new Date("2026-10-20T10:00:00Z"),
      ),
      plans,
      generations,
      capturePeriodReviews: () =>
        Promise.resolve([
          {
            kind: "week" as const,
            title: "Week starting 2026-10-12",
            startDate: "2026-10-12",
            endDate: "2026-10-18",
            summary: "The week was consistent; the long run was hard.",
            comment: null,
            reply: null,
            updatedAt: new Date().toISOString(),
          },
        ]),
    });

    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.plan.block.startDate).toBe("2026-10-21");
    expect(saved?.plan.block.focus).toBe(
      "Aerobic endurance with a recovery week",
    );
  });

  it("threads a captured review into the run without mutating the caller", async () => {
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
      new Date("2026-10-20T10:00:00Z"),
    );
    const reviewUpdatedAt = new Date("2026-10-21T08:00:00Z");
    const input: GeneratePlanInput = {
      userId: 1,
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
      capturePeriodReviews: () =>
        Promise.resolve([
          {
            kind: "week" as const,
            title: "Week starting 2026-10-12",
            startDate: "2026-10-12",
            endDate: "2026-10-18",
            summary: "The week was consistent; the long run was hard.",
            comment: null,
            reply: null,
            updatedAt: reviewUpdatedAt.toISOString(),
          },
        ]),
    };

    const saved = await runPlanGeneration(input);

    // The review reached the run that used it...
    expect(provider.calls).toEqual(["plan-update"]);
    expect(saved?.coachingInputsUpdatedAt).toEqual(reviewUpdatedAt);
    // ...without rewriting the caller's input.
    expect(input.context).toBe(context);
    expect(input.context.periodReviews).toBeUndefined();
    expect(input.context.weekReviewUpdatedAt).toBeUndefined();
    expect(input.context.coachingInputsUpdatedAt).toEqual(
      new Date("2026-10-20T10:00:00Z"),
    );
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
      runId: "run-1",
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
      runId: "run-1",
      today: "2026-10-21",
      plan: existing,
      context,
      plans,
      generations,
    });

    expect(provider.calls).toEqual(["plan-update"]);
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
        samples: [],
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
      runId: "run-1",
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
    expect(monday?.title).toBe("Session 1");
    expect(monday?.description).toBe("Easy aerobic work.");
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
        samples: [],
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
      runId: "run-1",
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
    expect(todaySession?.title).toBe("Session 3");
    expect(todaySession?.description).toBe("Easy aerobic work.");
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
        samples: [],
        analysis: null,
        analysisError: null,
        programAnalysis: null,
        comment: null,
        coachReply: null,
      },
    ];

    const saved = await runPlanGeneration({
      userId: 1,
      runId: "run-1",
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
        samples: [],
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
      runId: "run-1",
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
      runId: "run-1",
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
      runId: "run-1",
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
      runId: "run-1",
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
        samples: [],
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
      runId: "run-1",
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
});
