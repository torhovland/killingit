import { describe, expect, it, spyOn } from "bun:test";
import { addDays, type PlanGenerationStatus } from "@killingit/shared";
import type { ActivityFeed } from "../coaching/feed/presenter.js";
import type { LlmClient } from "../llm/client.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";
import type { CoachingInputs } from "./inputs.js";
import type { PlanGenerationStep } from "./steps.js";
import type { PlanGenerationStore, PlanStore, StoredPlan } from "./store.js";
import { makeAnalyzedActivity, makePlan } from "../testFixtures/plan.js";
import {
  MemoryPlanStore,
  makePlan as makeHarnessPlan,
  makeStoredPlan,
} from "../testFixtures/generationHarness.js";
import { PLAN_FAILED_MESSAGE } from "./failure.js";
import {
  HEARTBEAT_FAILURE_LIMIT,
  isGenerationSuperseded,
} from "./generation.js";
import { loadPlanGenerationContext } from "./generationContext.js";
import {
  startHeartbeat,
  triggerPlanGeneration,
  type PlanTriggerDependencies,
} from "./trigger.js";

const emptyInputs: CoachingInputs = {
  manualActivities: [],
  activityComments: [],
  weeklyNote: null,
  weeklyNoteWeekStartDate: null,
  weeklyNoteReply: null,
  weeklyNoteUpdatedAt: null,
  periodReviews: [],
  weekReviewUpdatedAt: null,
  weekReviewNeedsRefresh: false,
  blockReviewUpdatedAt: null,
  blockReviewNeedsRefresh: false,
  updatedAt: null,
  refreshUpdatedAt: null,
};

const emptyFeed: ActivityFeed = { model: null, activities: [] };

const llm: LlmClient = {
  provider: {
    id: "test",
    listModels: () => Promise.resolve([]),
    validateKey: () => Promise.resolve(),
    complete: () => Promise.resolve(""),
  },
  apiKey: "test-key",
  seasonModel: "test-model",
  dailyModel: "test-model",
};

const user = {
  id: 242,
  sub: "test|242",
  role: "member" as const,
  timezone: null,
  location: null,
  dietAdvice: false,
  createdAt: new Date("2026-11-12T00:00:00Z"),
};

/** The status a generation store reports before the first run. */
function idleStatus(): PlanGenerationStatus {
  return {
    status: "idle",
    step: null,
    progress: 0,
    error: null,
    runId: null,
    updatedAt: new Date().toISOString(),
  };
}

/** A generation row that records only the first failure for its run. */
class RecordingGenerationStore implements PlanGenerationStore {
  status: PlanGenerationStatus = idleStatus();
  failures: string[] = [];
  /** The steps the run showed, in order. */
  steps: PlanGenerationStep[] = [];

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
      this.status.status === "running" && this.status.runId === runId,
    );
  }

  update(
    _userId: number,
    step: PlanGenerationStep,
    runId: string,
  ): Promise<void> {
    if (this.status.runId !== runId) {
      return Promise.resolve();
    }
    this.steps.push(step);
    this.status = {
      ...this.status,
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
      error: null,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve();
  }

  fail(
    _userId: number,
    error: string,
    runId: string | null,
  ): Promise<Date | null> {
    if (this.status.status !== "running" || this.status.runId !== runId) {
      return Promise.resolve(null);
    }
    this.failures.push(error);
    this.status = {
      ...this.status,
      status: "error",
      step: "The coach could not finish your plan",
      error,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve(new Date());
  }
}

/** A generation store whose run claim fails before any background work starts. */
class FailingBeginStore extends RecordingGenerationStore {
  override begin(): Promise<void> {
    return Promise.reject(new Error("database unavailable"));
  }
}

const plans: PlanStore = {
  load: () => Promise.resolve(null),
  save: () => Promise.resolve(null),
};

const answers: QuestionAnswerStore = {
  listForUser: () => Promise.resolve([]),
  saveAnswers: () => Promise.resolve(true),
};

const users: UserStore = {
  ensureUser: () => Promise.reject(new Error("not used")),
  getById: () => Promise.resolve(user),
  updateSettings: () => Promise.reject(new Error("not used")),
  deleteUser: () => Promise.resolve(),
};

/**
 * A plan run whose every loader and writer is in memory. A test replaces only
 * the dependency it exercises; nothing here reaches the database.
 */
function dependencies(
  generations: PlanGenerationStore,
  overrides: Partial<PlanTriggerDependencies> = {},
): PlanTriggerDependencies {
  return {
    users,
    answers,
    plans,
    generations,
    coachingSurveyAdjustments: {
      listForUser: () => Promise.resolve([]),
      append: () => Promise.resolve(),
      clearConsumed: () => Promise.resolve(),
    },
    loadActivities: () => Promise.resolve(emptyFeed),
    loadThresholdHistory: () =>
      Promise.resolve({ points: [], timelines: [], summaries: [] }),
    loadBodyHistory: () => Promise.resolve({ weight: [], bodyFat: [] }),
    loadDailyHealth: () => Promise.resolve([]),
    loadEvents: () => Promise.resolve([]),
    loadDiet: () => Promise.resolve(null),
    loadDayCalories: () => Promise.resolve(new Map()),
    latestActivityAnalysisSince: () => Promise.resolve(null),
    capturePeriodReviews: () => Promise.resolve([]),
    recordFtpEstimates: () => Promise.resolve(),
    recordBodyMetrics: () => Promise.resolve(),
    saveCoachQuestions: () => Promise.resolve(),
    clearPendingCoachQuestions: () => Promise.resolve(),
    loadCoachingInputs: () => Promise.resolve(emptyInputs),
    loadLlm: () => Promise.resolve(llm),
    syncAthleteReading: () => Promise.resolve(null),
    loadAnsweredCoachQuestions: () => Promise.resolve([]),
    markPlanPromptsFailed: () => Promise.resolve(),
    // Tests share the local debounce window; keep every run immediate.
    planTriggerDebounceMs: 0,
    ...overrides,
  };
}

/** Lets the background run settle after the trigger returns. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Waits until the background run reaches the state the test asserts. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
    await settle();
  }
}

describe("plan generation failure handling", () => {
  it("marks the generation failed when a phase after loading throws", async () => {
    const generations = new RecordingGenerationStore();
    const deps = dependencies(generations, {
      syncAthleteReading: () => Promise.reject(new Error("reading failed")),
    });

    await triggerPlanGeneration(deps, { userId: 242, today: "2026-11-12" });
    await settle();

    expect(generations.status.status).toBe("error");
    // The athlete sees a generic reason; the raw failure is in the log.
    expect(generations.status.error).toBe(PLAN_FAILED_MESSAGE);
    expect(generations.failures).toEqual([PLAN_FAILED_MESSAGE]);
  });

  it("reports a background failure to the injected reporter", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const generations = new RecordingGenerationStore();
    const reported: unknown[] = [];
    const deps = dependencies(generations, {
      syncAthleteReading: () => Promise.reject(new Error("reading failed")),
      reportError: (error) => {
        reported.push(error);
      },
    });

    await triggerPlanGeneration(deps, { userId: 242, today: "2026-11-12" });
    await settle();
    log.mockRestore();

    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe("reading failed");
  });

  it("plans on when an advisory input cannot be read", async () => {
    const generations = new RecordingGenerationStore();
    const log = spyOn(console, "error").mockImplementation(() => {});
    let completions = 0;
    const deps = dependencies(generations, {
      loadDiet: () => Promise.reject(new Error("diet read failed")),
      loadLlm: () =>
        Promise.resolve({
          ...llm,
          provider: {
            ...llm.provider,
            complete: () => {
              completions += 1;
              return Promise.resolve("");
            },
          },
        }),
    });

    try {
      await triggerPlanGeneration(deps, { userId: 242, today: "2026-11-12" });
      await waitFor(() => completions > 0);

      expect(completions).toBeGreaterThan(0);
      expect(generations.failures).not.toContain("diet read failed");
      expect(
        log.mock.calls.some((call) =>
          String(call[0]).includes("could not read the diet log"),
        ),
      ).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("reports a missing model before it syncs activities", async () => {
    const generations = new RecordingGenerationStore();
    const deps = dependencies(generations, {
      // An absent feed loader means "sync first"; a run without a model must
      // not reach that sync.
      loadActivities: undefined,
      loadLlm: () => Promise.resolve(null),
    });

    await triggerPlanGeneration(deps, { userId: 242, today: "2026-11-12" });
    await settle();

    expect(generations.status.status).toBe("error");
    expect(generations.status.error).toBe(
      "OpenRouter is not configured. Add a key and model first.",
    );
    expect(generations.failures).toEqual([
      "OpenRouter is not configured. Add a key and model first.",
    ]);
    expect(generations.steps).toEqual([]);
  });

  it("reads the model before the already-loaded activity feed", async () => {
    const generations = new RecordingGenerationStore();
    const reads: string[] = [];
    const deps = dependencies(generations, {
      loadLlm: () => {
        reads.push("model");
        return Promise.resolve(llm);
      },
      loadActivities: () => {
        reads.push("activities");
        return Promise.resolve(emptyFeed);
      },
    });

    await triggerPlanGeneration(deps, { userId: 242, today: "2026-11-12" });
    await waitFor(() => reads.includes("activities"));

    expect(reads.slice(0, 2)).toEqual(["model", "activities"]);
  });

  it("propagates a failed run claim without starting a run", async () => {
    const generations = new FailingBeginStore();
    const deps = dependencies(generations);

    let failed: unknown = null;
    try {
      await triggerPlanGeneration(deps, { userId: 242, today: "2026-11-12" });
    } catch (err) {
      failed = err;
    }
    await settle();

    expect((failed as Error).message).toBe("database unavailable");
    expect(generations.failures).toEqual([]);
  });
});

describe("loadPlanGenerationContext", () => {
  const run = {
    userId: 242,
    today: "2026-11-12",
    runId: "run-1",
    signal: new AbortController().signal,
  };

  it("returns the stored plan, the account and the feed a run needs", async () => {
    const generations = new RecordingGenerationStore();
    await generations.begin(run.userId, run.runId);
    const deps = dependencies(generations);

    const context = await loadPlanGenerationContext(deps, run);

    expect(context).not.toBeNull();
    expect(context?.plan).toBeNull();
    expect(context?.answers).toEqual([]);
    expect(context?.llm).toEqual(llm);
    expect(context?.coachingInputs).toEqual(emptyInputs);
    expect(context?.user).toEqual(user);
    expect(context?.coachAnswers).toEqual([]);
    expect(context?.surveyAdjustments).toEqual([]);
    expect(context?.activities).toEqual(emptyFeed);
    expect(context?.activitiesSnapshotAt).toBeGreaterThan(0);
  });

  it("treats a stored plan that fails the schema as absent", async () => {
    const generations = new RecordingGenerationStore();
    await generations.begin(run.userId, run.runId);
    const stale = makePlan();
    delete (stale.week as unknown as Record<string, unknown>).rationale;
    const stored: StoredPlan = {
      plan: stale,
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-11-10T08:00:00Z"),
    };
    const error = spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies(generations, {
      plans: {
        load: () => Promise.resolve(stored),
        save: () => Promise.resolve(null),
      },
    });

    try {
      const context = await loadPlanGenerationContext(deps, run);

      expect(context?.plan).toBeNull();
      expect(generations.failures).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it("returns a stored plan that matches the schema", async () => {
    const generations = new RecordingGenerationStore();
    await generations.begin(run.userId, run.runId);
    const stored: StoredPlan = {
      plan: makePlan(),
      answersUpdatedAt: null,
      coachingInputsUpdatedAt: null,
      activitiesUpdatedAt: null,
      generatedAt: new Date("2026-11-11T08:00:00Z"),
    };
    const deps = dependencies(generations, {
      plans: {
        load: () => Promise.resolve(stored),
        save: () => Promise.resolve(null),
      },
    });

    const context = await loadPlanGenerationContext(deps, run);

    expect(context?.plan).toEqual(stored);
  });

  it("fails the generation when a required input cannot be read", async () => {
    const generations = new RecordingGenerationStore();
    await generations.begin(run.userId, run.runId);
    const deps = dependencies(generations, {
      loadCoachingInputs: () =>
        Promise.reject(new Error("coaching inputs unavailable")),
    });

    let failed: unknown = null;
    try {
      await loadPlanGenerationContext(deps, run);
    } catch (err) {
      failed = err;
    }

    expect((failed as Error).message).toBe("coaching inputs unavailable");
    // The thrown error keeps the detail for the caller; the stored reason does
    // not. See ADR 0038.
    expect(generations.failures).toEqual([PLAN_FAILED_MESSAGE]);
  });

  it("reports a superseded run instead of failing the row", async () => {
    const generations = new RecordingGenerationStore();
    await generations.begin(run.userId, run.runId);
    const controller = new AbortController();
    const deps = dependencies(generations, {
      loadCoachingInputs: () => {
        controller.abort();
        return Promise.reject(new Error("aborted"));
      },
    });

    let failed: unknown = null;
    try {
      await loadPlanGenerationContext(deps, {
        ...run,
        signal: controller.signal,
      });
    } catch (err) {
      failed = err;
    }

    expect(isGenerationSuperseded(failed)).toBe(true);
    expect(generations.failures).toEqual([]);
  });
});

describe("plan generation load history", () => {
  const today = "2026-10-21";

  /** `count` cycling activities, newest first; the oldest fall outside the prompt cap. */
  function feed(count: number): ActivityFeed {
    return {
      model: null,
      activities: Array.from({ length: count }, (_, index) =>
        makeAnalyzedActivity({
          id: index + 1,
          startDate: `${addDays(today, -(index + 30))}T09:00:00Z`,
          ...(index === 0
            ? {
                analysis: {
                  text: "Easy aerobic ride.",
                  model: "test-model",
                  generatedAt: "2026-10-20T09:00:00Z",
                  planChangeNeeded: false,
                },
              }
            : {}),
        }),
      ),
    };
  }

  async function savedTodayCtl(
    activities: ActivityFeed,
  ): Promise<number | undefined> {
    const generations = new RecordingGenerationStore();
    const plans = new MemoryPlanStore(
      makeStoredPlan(
        makeHarnessPlan(today),
        null,
        null,
        new Date("2026-10-19T00:00:00Z"),
      ),
    );
    const deps = dependencies(generations, {
      plans,
      loadActivities: () => Promise.resolve(activities),
    });

    await triggerPlanGeneration(deps, {
      userId: 242,
      today,
      includeTomorrow: false,
    });
    await waitFor(
      () =>
        generations.status.status === "done" ||
        generations.status.status === "error",
    );

    expect(generations.status.status).toBe("done");
    return plans.saved?.plan.today.trainingLoad?.ctl;
  }

  it("seeds the plan's load from the whole stored activity history", async () => {
    // The oldest five activities sit outside the prompt's 20-activity window
    // but still inside CTL's 42-day warm-up, so they must raise the plan's load.
    const wholeHistory = await savedTodayCtl(feed(25));
    const cappedHistory = await savedTodayCtl(feed(20));

    expect(wholeHistory).toBeDefined();
    expect(wholeHistory ?? 0).toBeGreaterThan(cappedHistory ?? 0);
  });
});

describe("generation heartbeat", () => {
  /** Runs the event loop a few turns so the interval can fire. */
  async function turns(count: number): Promise<void> {
    for (let turn = 0; turn < count; turn += 1) {
      await settle();
    }
  }

  it("stops a run whose heartbeat keeps failing", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const reported: unknown[] = [];
    const stopped: unknown[] = [];
    let beats = 0;
    const generations = new RecordingGenerationStore();
    await generations.begin(242, "run-1");
    generations.heartbeat = () => {
      beats += 1;
      return Promise.reject(new Error("Connection terminated unexpectedly"));
    };
    const deps = dependencies(generations, {
      reportError: (error) => {
        reported.push(error);
      },
    });

    const heartbeat = startHeartbeat(deps, {
      userId: 242,
      runId: "run-1",
      intervalMs: 1,
      stop: (error) => {
        stopped.push(error);
      },
    });
    await waitFor(() => stopped.length > 0);
    const beatsAtStop = beats;
    await turns(3);
    clearInterval(heartbeat);
    log.mockRestore();

    expect(stopped).toHaveLength(1);
    expect((stopped[0] as Error).message).toBe(
      "Connection terminated unexpectedly",
    );
    expect(reported).toHaveLength(1);
    expect(generations.failures).toEqual([PLAN_FAILED_MESSAGE]);
    // The stopped run stops heartbeating; it does not keep failing forever.
    expect(beats).toBe(beatsAtStop);
  });

  it("logs a single failed heartbeat without stopping the run", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const stopped: unknown[] = [];
    let beats = 0;
    const generations = new RecordingGenerationStore();
    await generations.begin(242, "run-1");
    generations.heartbeat = () => {
      beats += 1;
      return beats === 1
        ? Promise.reject(new Error("Socket is closed"))
        : Promise.resolve();
    };

    const heartbeat = startHeartbeat(dependencies(generations), {
      userId: 242,
      runId: "run-1",
      intervalMs: 1,
      stop: (error) => {
        stopped.push(error);
      },
    });
    await waitFor(() => beats > 2);
    clearInterval(heartbeat);
    log.mockRestore();

    expect(stopped).toEqual([]);
    expect(generations.failures).toEqual([]);
  });

  it("resets the failure count when a heartbeat succeeds", async () => {
    const stopped: unknown[] = [];
    let beats = 0;
    const generations = new RecordingGenerationStore();
    await generations.begin(242, "run-1");
    generations.heartbeat = () => {
      beats += 1;
      return beats % 2 === 0
        ? Promise.resolve()
        : Promise.reject(new Error("Socket is closed"));
    };

    const heartbeat = startHeartbeat(dependencies(generations), {
      userId: 242,
      runId: "run-1",
      intervalMs: 1,
      stop: (error) => {
        stopped.push(error);
      },
    });
    // More failures than the limit, but never that many in a row.
    await waitFor(() => beats > HEARTBEAT_FAILURE_LIMIT * 2);
    clearInterval(heartbeat);

    expect(stopped).toEqual([]);
  });
});
