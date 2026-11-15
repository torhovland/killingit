import type {
  AthleteEvent,
  AthleteLocation,
  PlanGenerationStatus,
} from "@killingit/shared";
import type { ActivityFeed } from "../coaching/feed/presenter.js";
import type { AppDependencies } from "../dependencies.js";
import { createApp } from "../index.js";
import type { CoachingInputs } from "../plans/inputs.js";
import type {
  PlanGenerationStore,
  PlanSaveInput,
  PlanStore,
  StoredPlan,
} from "../plans/store.js";
import type { PlanGenerationStep } from "../plans/steps.js";
import type {
  QuestionAnswerStore,
  StoredAthleteQuestion,
} from "../questions/answers.js";
import type { CoachingSurveyAdjustmentStore } from "../questions/adjustments.js";
import { EMPTY_ACTIVITY_LOADS } from "../training/activityLoad.js";
import { makePlan } from "./plan.js";
import { apiRequest } from "./request.js";

/** The answer the fake account store reports for the signed-in athlete. */
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
  previous: null,
};

/** Survey adjustments a route test reads as empty unless it overrides them. */
const emptySurveyAdjustments: CoachingSurveyAdjustmentStore = {
  listForUser: () => Promise.resolve([]),
  append: () => Promise.resolve(),
  clearConsumed: () => Promise.resolve(),
};

/** Coaching inputs a route test reads as empty unless it overrides them. */
const emptyCoachingInputs: CoachingInputs = {
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

/** An in-memory plan store, enough for a route test to read what it wrote. */
export class MemoryPlanStore implements PlanStore {
  constructor(public stored: StoredPlan | null) {}

  load(): Promise<StoredPlan | null> {
    return Promise.resolve(this.stored);
  }

  save({
    plan,
    answersUpdatedAt,
    coachingInputsUpdatedAt = null,
    activitiesUpdatedAt = null,
  }: PlanSaveInput): Promise<StoredPlan> {
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

/**
 * An in-memory generation store. A run claims the store with `begin`, and
 * `fail` keeps a newer run's status when the caller's `runId` no longer owns
 * it, exactly like the database store.
 */
export class MemoryGenerationStore implements PlanGenerationStore {
  status: PlanGenerationStatus = idleStatus();
  running = false;

  load(): Promise<PlanGenerationStatus> {
    return Promise.resolve(this.status);
  }

  begin(_userId: number, runId: string): Promise<void> {
    this.running = true;
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
    return Promise.resolve(this.running && this.status.runId === runId);
  }

  update(
    _userId: number,
    step: PlanGenerationStep,
    _runId: string,
  ): Promise<void> {
    this.status = {
      ...this.status,
      status: "running",
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

  fail(_userId: number, error: string, runId: string): Promise<Date | null> {
    if (this.status.runId !== runId) {
      return Promise.resolve(null);
    }
    this.running = false;
    this.status = {
      ...this.status,
      status: "error",
      error,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve(new Date());
  }
}

/** Every injectable a route test may substitute for a database-backed default. */
export interface TestAppOptions {
  planStore?: PlanStore;
  generationStore?: PlanGenerationStore;
  answers?: QuestionAnswerStore;
  location?: AthleteLocation | null;
  events?: AthleteEvent[];
  coachingInputs?: CoachingInputs;
  loadForecast?: AppDependencies["loadForecast"];
  markPlanPromptsFailed?: AppDependencies["markPlanPromptsFailed"];
  loadActivities?: (userId: number) => Promise<ActivityFeed>;
  loadStoredFeed?: AppDependencies["loadStoredFeed"];
  loadActivityFeedback?: AppDependencies["loadActivityFeedback"];
  loadActivityTrainingLoads?: AppDependencies["loadActivityTrainingLoads"];
  estimateManualTss?: AppDependencies["estimateManualTss"];
  loadThresholdHistory?: AppDependencies["loadThresholdHistory"];
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  createActivityComment?: AppDependencies["createActivityComment"];
  updateActivityComment?: AppDependencies["updateActivityComment"];
  saveActivityReview?: AppDependencies["saveActivityReview"];
  saveManualActivity?: AppDependencies["saveManualActivity"];
  updateManualActivity?: AppDependencies["updateManualActivity"];
  updateManualActivityTss?: AppDependencies["updateManualActivityTss"];
  saveWeeklyNote?: AppDependencies["saveWeeklyNote"];
  deleteImportedActivity?: AppDependencies["deleteImportedActivity"];
  deleteManualActivity?: AppDependencies["deleteManualActivity"];
  replyToCoachingInput?: AppDependencies["replyToCoachingInput"];
  answerCoachingQuestion?: AppDependencies["answerCoachingQuestion"];
  loadManualActivities?: AppDependencies["loadManualActivities"];
  loadManualActivityReplies?: AppDependencies["loadManualActivityReplies"];
  loadWeeklyNote?: AppDependencies["loadWeeklyNote"];
  loadWeeklyNoteReply?: AppDependencies["loadWeeklyNoteReply"];
  loadPeriodReviews?: AppDependencies["loadPeriodReviews"];
  loadPeriodReview?: AppDependencies["loadPeriodReview"];
  createPeriodReviewComment?: AppDependencies["createPeriodReviewComment"];
  updatePeriodReviewComment?: AppDependencies["updatePeriodReviewComment"];
  markPeriodReviewReviewed?: AppDependencies["markPeriodReviewReviewed"];
  loadPendingCoachQuestion?: AppDependencies["loadPendingCoachQuestion"];
  loadAnsweredCoachQuestions?: AppDependencies["loadAnsweredCoachQuestions"];
  loadCoachQuestion?: AppDependencies["loadCoachQuestion"];
  answerCoachQuestion?: AppDependencies["answerCoachQuestion"];
  replyToCoachQuestion?: AppDependencies["replyToCoachQuestion"];
  triggerPlanGeneration?: AppDependencies["triggerPlanGeneration"];
  startCoachRun?: AppDependencies["startCoachRun"];
}

/**
 * The one app builder for route tests. It signs in a member account, gives
 * every route a DB-free default, and lets a test replace only the dependency
 * it exercises. Extend this builder instead of copying it into a new suite.
 */
export function makeTestApp(options: TestAppOptions = {}) {
  const location = options.location ?? null;
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore: {
      ensureUser: (sub) =>
        Promise.resolve({
          id: 42,
          sub,
          role: "member",
          timezone: null,
          location,
          dietAdvice: false,
          createdAt: new Date(0),
        }),
      getById: (id) =>
        Promise.resolve({
          id,
          sub: "athlete-1",
          role: "member",
          timezone: null,
          location,
          dietAdvice: false,
          createdAt: new Date(0),
        }),
      deleteUser: () => Promise.resolve(),
      updateSettings: (sub, settings) =>
        Promise.resolve({
          id: 42,
          sub,
          role: "member",
          timezone: settings.timezone ?? null,
          location: settings.location ?? null,
          dietAdvice: false,
          createdAt: new Date(0),
        }),
    },
    answerStore:
      options.answers ??
      ({
        listForUser: () => Promise.resolve([storedQuestion]),
        saveAnswers: () => Promise.resolve(true),
      } satisfies QuestionAnswerStore),
    coachingSurveyAdjustments: emptySurveyAdjustments,
    planStore: options.planStore ?? new MemoryPlanStore(null),
    generationStore: options.generationStore ?? new MemoryGenerationStore(),
    loadActivities:
      options.loadActivities ??
      (() => Promise.resolve({ model: "test-model", activities: [] })),
    loadStoredFeed:
      options.loadStoredFeed ??
      (() => Promise.resolve({ model: null, activities: [] })),
    loadActivityFeedback:
      options.loadActivityFeedback ?? (() => Promise.resolve(new Map())),
    loadActivityTrainingLoads:
      options.loadActivityTrainingLoads ??
      (() => Promise.resolve(EMPTY_ACTIVITY_LOADS)),
    estimateManualTss: options.estimateManualTss ?? (() => Promise.resolve(0)),
    loadThresholdHistory:
      options.loadThresholdHistory ??
      (() =>
        Promise.resolve({
          points: [],
          timelines: [],
          summaries: [],
        })),
    loadBodyHistory: () => Promise.resolve({ weight: [], bodyFat: [] }),
    syncAthleteReading: () => Promise.resolve(null),
    planTriggerDebounceMs: 0,
    loadEvents: () => Promise.resolve(options.events ?? []),
    loadDiet: () => Promise.resolve(null),
    loadLlm: () =>
      Promise.resolve({
        provider: {
          id: "fake",
          listModels: () => Promise.resolve([]),
          validateKey: () => Promise.resolve(),
          complete: () => Promise.resolve(JSON.stringify(makePlan())),
        },
        apiKey: "test-key",
        seasonModel: "test-model",
        dailyModel: "test-model",
      }),
    loadCoachingInputs:
      options.loadCoachingInputs ??
      (() => Promise.resolve(options.coachingInputs ?? emptyCoachingInputs)),
    replyToCoachingInput:
      options.replyToCoachingInput ?? (() => Promise.resolve(null)),
    answerCoachingQuestion:
      options.answerCoachingQuestion ?? (() => Promise.resolve(null)),
    loadAnsweredCoachQuestions:
      options.loadAnsweredCoachQuestions ?? (() => Promise.resolve([])),
    loadManualActivities:
      options.loadManualActivities ?? (() => Promise.resolve([])),
    loadManualActivityReplies:
      options.loadManualActivityReplies ?? (() => Promise.resolve(new Map())),
    loadWeeklyNote: options.loadWeeklyNote ?? (() => Promise.resolve(null)),
    loadWeeklyNoteReply:
      options.loadWeeklyNoteReply ?? (() => Promise.resolve(null)),
    createActivityComment: options.createActivityComment,
    updateActivityComment: options.updateActivityComment,
    saveActivityReview: options.saveActivityReview,
    saveManualActivity: options.saveManualActivity,
    updateManualActivity: options.updateManualActivity,
    updateManualActivityTss: options.updateManualActivityTss,
    saveWeeklyNote: options.saveWeeklyNote,
    deleteImportedActivity: options.deleteImportedActivity,
    deleteManualActivity: options.deleteManualActivity,
    loadPeriodReviews: options.loadPeriodReviews,
    loadPeriodReview: options.loadPeriodReview,
    createPeriodReviewComment: options.createPeriodReviewComment,
    updatePeriodReviewComment: options.updatePeriodReviewComment,
    markPeriodReviewReviewed: options.markPeriodReviewReviewed,
    loadPendingCoachQuestion: options.loadPendingCoachQuestion,
    loadCoachQuestion: options.loadCoachQuestion,
    answerCoachQuestion: options.answerCoachQuestion,
    replyToCoachQuestion: options.replyToCoachQuestion,
    triggerPlanGeneration: options.triggerPlanGeneration,
    startCoachRun: options.startCoachRun ?? (() => Promise.resolve(true)),
    loadForecast: options.loadForecast,
    markPlanPromptsFailed: options.markPlanPromptsFailed,
  });
}

/** A request carrying both the bearer token and the API contract version. */
export function authenticatedRequest(
  path: string,
  init?: RequestInit,
): Request {
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer anything");
  return apiRequest(`http://localhost${path}`, { ...init, headers });
}
