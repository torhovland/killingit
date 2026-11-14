import { describe, expect, it, spyOn } from "bun:test";
import type { PlanGenerationStatus } from "@killingit/shared";
import type { ActivityFeed } from "../coaching/activities.js";
import type { LlmClient } from "../llm/client.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";
import type { CoachingInputs } from "./inputs.js";
import type { PlanGenerationStep } from "./steps.js";
import { idleGenerationStatus } from "./store.js";
import type { PlanGenerationStore, PlanStore, StoredPlan } from "./store.js";
import { makePlan } from "../testFixtures/plan.js";
import { isGenerationSuperseded } from "./generation.js";
import { loadPlanGenerationContext } from "./generationContext.js";
import {
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
  model: "test-model",
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

/** A generation row that records only the first failure for its run. */
class RecordingGenerationStore implements PlanGenerationStore {
  status: PlanGenerationStatus = idleGenerationStatus();
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
    expect(generations.status.error).toBe("reading failed");
    expect(generations.failures).toEqual(["reading failed"]);
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
    expect(generations.failures).toEqual(["coaching inputs unavailable"]);
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
