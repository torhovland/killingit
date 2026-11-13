import { describe, expect, it } from "bun:test";
import type { PlanGenerationStatus } from "@killingit/shared";
import type { ActivityFeed } from "../coaching/activities.js";
import type { LlmClient } from "../llm/client.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";
import type { CoachingInputs } from "./inputs.js";
import type { PlanGenerationStep } from "./steps.js";
import { idleGenerationStatus } from "./store.js";
import type { PlanGenerationStore, PlanStore } from "./store.js";
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

function dependencies(
  generations: PlanGenerationStore,
  loadDiet: PlanTriggerDependencies["loadDiet"],
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
    loadCoachingInputs: () => Promise.resolve(emptyInputs),
    loadLlm: () => Promise.resolve(llm),
    syncAthleteReading: () => Promise.resolve(null),
    loadEvents: () => Promise.resolve([]),
    loadDiet,
    loadAnsweredCoachQuestions: () => Promise.resolve([]),
  };
}

/** Lets the background run settle after the trigger returns. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("plan generation failure handling", () => {
  it("marks the generation failed when a phase after loading throws", async () => {
    const generations = new RecordingGenerationStore();
    const deps = dependencies(generations, () =>
      Promise.reject(new Error("diet read failed")),
    );

    await triggerPlanGeneration(deps, { userId: 242, today: "2026-11-12" });
    await settle();

    expect(generations.status.status).toBe("error");
    expect(generations.status.error).toBe("diet read failed");
    expect(generations.failures).toEqual(["diet read failed"]);
  });

  it("propagates a failed run claim without starting a run", async () => {
    const generations = new FailingBeginStore();
    const deps = dependencies(generations, () => Promise.resolve(null));

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
