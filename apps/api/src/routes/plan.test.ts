import { describe, expect, it } from "bun:test";
import type { CoachPlan, PlanGenerationStatus } from "@killingit/shared";
import { createApp } from "../index.js";
import type { CoachingInputs } from "../plans/inputs.js";
import type {
  PlanGenerationStore,
  PlanStore,
  StoredPlan,
} from "../plans/store.js";
import { idleGenerationStatus } from "../plans/store.js";
import type {
  QuestionAnswerStore,
  StoredAthleteQuestion,
} from "../questions/answers.js";

const storedQuestion: StoredAthleteQuestion = {
  id: 1,
  versionId: 1,
  prompt: "What is your goal?",
  required: true,
  version: 1,
  versionCount: 1,
  createdAt: new Date("2026-10-20T09:00:00Z"),
  updatedAt: new Date("2026-10-20T09:00:00Z"),
  answer: "Run a marathon.",
  skipped: false,
  answeredAt: new Date("2026-10-20T10:00:00Z"),
};

function makePlan(today = "2026-10-21"): CoachPlan {
  return {
    season: {
      goal: "Run a marathon.",
      startDate: "2026-10-21",
      endDate: "2027-04-01",
      rationale: "Build a base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-21",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      rationale: "Establish consistent volume.",
      startDate: "2026-10-21",
      endDate: "2026-12-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
        },
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic",
      rationale: "Keep the week easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout",
        title: `Session ${index + 1}`,
        description: "Easy.",
        durationMinutes: 45,
        intensity: "easy",
        status: "planned",
      })),
    },
    today: {
      date: today,
      type: "workout",
      title: "Easy run",
      description: "Easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      optionalRationale:
        "This easy run keeps the week consistent; skip it only if you feel unusually tired.",
      status: "planned",
    },
    tomorrow: null,
  };
}

class MemoryPlanStore implements PlanStore {
  constructor(public stored: StoredPlan | null) {}

  load(): Promise<StoredPlan | null> {
    return Promise.resolve(this.stored);
  }

  save(
    _userId: number,
    plan: CoachPlan,
    answersUpdatedAt: Date | null,
    coachingInputsUpdatedAt: Date | null = null,
    activitiesUpdatedAt: Date | null = null,
  ): Promise<StoredPlan> {
    this.stored = {
      plan,
      answersUpdatedAt,
      coachingInputsUpdatedAt,
      activitiesUpdatedAt,
      generatedAt: new Date(),
    };
    return Promise.resolve(this.stored);
  }
}

class MemoryGenerationStore implements PlanGenerationStore {
  status: PlanGenerationStatus = idleGenerationStatus();
  running = false;

  load(): Promise<PlanGenerationStatus> {
    return Promise.resolve(this.status);
  }

  begin(): Promise<boolean> {
    if (this.running) {
      return Promise.resolve(false);
    }
    this.running = true;
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
    this.running = false;
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
    this.running = false;
    this.status = {
      ...this.status,
      status: "error",
      error,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }
}

function makeApp(options: {
  planStore?: PlanStore;
  generationStore?: PlanGenerationStore;
  answers?: QuestionAnswerStore;
  coachingInputs?: CoachingInputs;
}) {
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore: {
      ensureUser: (sub) =>
        Promise.resolve({
          id: 42,
          sub,
          role: "member",
          timezone: null,
          createdAt: new Date(0),
        }),
      updateTimezone: (sub, timezone) =>
        Promise.resolve({
          id: 42,
          sub,
          role: "member",
          timezone,
          createdAt: new Date(0),
        }),
    },
    answerStore:
      options.answers ??
      ({
        listForUser: () => Promise.resolve([storedQuestion]),
        saveAnswers: () => Promise.resolve(true),
      } satisfies QuestionAnswerStore),
    planStore: options.planStore ?? new MemoryPlanStore(null),
    generationStore: options.generationStore ?? new MemoryGenerationStore(),
    loadActivities: () =>
      Promise.resolve({ model: "test-model", activities: [] }),
    loadLlm: () =>
      Promise.resolve({
        provider: {
          id: "fake",
          listModels: () => Promise.resolve([]),
          validateKey: () => Promise.resolve(),
          complete: () => Promise.resolve(JSON.stringify(makePlan())),
        },
        apiKey: "test-key",
        model: "test-model",
      }),
    loadCoachingInputs: () =>
      Promise.resolve(
        options.coachingInputs ?? {
          manualActivities: [],
          activityComments: [],
          weeklyNote: null,
          periodReviews: [],
          updatedAt: null,
        },
      ),
  });
}

function authenticatedRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer anything");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

/** Waits for the background generation to settle in the in-memory store. */
async function waitForGeneration(store: MemoryGenerationStore): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (store.status.status === "done" || store.status.status === "error") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("generation did not finish");
}

describe("coach plan route", () => {
  it("requires a bearer token", async () => {
    const res = await makeApp({}).fetch(
      new Request("http://localhost/api/coaching/plan?today=2026-10-21"),
    );
    expect(res.status).toBe(401);
  });

  it("reports an empty plan and pending levels", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: unknown;
      pending: { initial: boolean };
      generation: { status: string };
    };
    expect(body.plan).toBeNull();
    expect(body.pending.initial).toBe(true);
    expect(body.generation.status).toBe("idle");
  });

  it("rejects a missing today date", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest("/api/coaching/plan"),
    );
    expect(res.status).toBe(400);
  });

  it("returns a stored plan that covers today", async () => {
    const plan = makePlan();
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: {
        initial: boolean;
        day: boolean;
        week: boolean;
        block: boolean;
        tomorrow: boolean;
      };
      stale: boolean;
    };
    expect(body.pending).toEqual({
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: false,
    });
    expect(body.stale).toBe(false);
  });

  it("treats a completed day that is still planned on the week as pending", async () => {
    const plan = makePlan();
    plan.today = {
      ...plan.today,
      title: "Completed morning run",
      description: "Completed: running · 10.00 km · 50 min",
      durationMinutes: 50,
      status: "completed",
    };
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: { week: boolean; day: boolean };
    };
    expect(body.pending.day).toBe(false);
    expect(body.pending.week).toBe(true);
  });

  it("marks the plan stale when a coaching input is newer than the plan", async () => {
    const plan = makePlan();
    const planStore = new MemoryPlanStore({
      plan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({
      planStore,
      coachingInputs: {
        manualActivities: [],
        activityComments: [],
        weeklyNote: "I cannot train on Friday this week.",
        periodReviews: [],
        updatedAt: new Date("2026-10-21T08:00:00Z"),
      },
    }).fetch(authenticatedRequest("/api/coaching/plan?today=2026-10-21"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { stale: boolean };
    expect(body.stale).toBe(true);
  });

  it("treats an invalid stored plan as absent instead of failing", async () => {
    const invalidPlan = makePlan();
    // Simulate a plan saved under an older schema that predates `rationale`.
    delete (invalidPlan.week as unknown as Record<string, unknown>).rationale;
    const planStore = new MemoryPlanStore({
      plan: invalidPlan,
      answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-10-20T10:00:00Z"),
    });

    const res = await makeApp({ planStore }).fetch(
      authenticatedRequest("/api/coaching/plan?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: unknown;
      pending: { initial: boolean };
    };
    expect(body.plan).toBeNull();
    expect(body.pending.initial).toBe(true);
  });

  it("generates a full plan on POST", async () => {
    const planStore = new MemoryPlanStore(null);
    const generationStore = new MemoryGenerationStore();
    const testApp = makeApp({ planStore, generationStore });

    const res = await testApp.fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21" }),
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      plan: { today: { date: string } } | null;
      generation: { status: string };
    };
    // The request returns before the background generation finishes.
    expect(body.generation.status).toBe("running");

    await waitForGeneration(generationStore);
    expect(generationStore.status.status).toBe("done");
    expect(planStore.stored?.plan.today.date).toBe("2026-10-21");
  });

  it("returns 202 when a generation is already running", async () => {
    const generationStore = new MemoryGenerationStore();
    generationStore.running = true;
    const testApp = makeApp({ generationStore });

    const res = await testApp.fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21" }),
      }),
    );

    expect(res.status).toBe(202);
  });

  it("rejects an invalid generate body", async () => {
    const res = await makeApp({}).fetch(
      authenticatedRequest("/api/coaching/plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
