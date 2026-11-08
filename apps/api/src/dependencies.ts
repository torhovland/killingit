import type { AuthProvider } from "./auth/provider.js";
import type {
  ActivityFeed,
  loadUserActivityTrainingLoads,
} from "./coaching/activities.js";
import type { syncAthleteEvents } from "./coaching/athleteEvents.js";
import type { syncAthleteMetrics } from "./coaching/athleteMetrics.js";
import type {
  deleteImportedActivity,
  deleteManualActivity,
} from "./coaching/deletions.js";
import type { loadCachedActivityFeed } from "./coaching/feedCache.js";
import type {
  answerCoachingQuestion,
  replyToCoachQuestion,
  replyToCoachingInput,
} from "./coaching/replies.js";
import type { ReplyContextInput } from "./coaching/replyContext.js";
import type { saveActivityReview } from "./coaching/reviews.js";
import type { startCoachRun } from "./coaching/coachRun.js";
import type { loadDietContext } from "./diet/context.js";
import type { FoodEntryStore } from "./diet/store.js";
import type { createMealThumbnail } from "./diet/thumbnail.js";
import type { loadAthleteEvents } from "./events/store.js";
import type { analyzeFood } from "./llm/foodAnalysis.js";
import type { LlmClient } from "./llm/client.js";
import type { PlanContextInput } from "./llm/planContext.js";
import type { loadDailyHealthForUser } from "./metrics/dailyMetrics.js";
import type {
  loadBodyHistoryForUser,
  loadThresholdHistoryForUser,
} from "./metrics/store.js";
import type {
  CoachingInputs,
  createActivityComment,
  loadManualActivities,
  loadWeeklyNote,
  saveManualActivity,
  saveWeeklyNote,
  updateActivityComment,
  updateManualActivity,
} from "./plans/inputs.js";
import type {
  answerCoachQuestion,
  loadAnsweredCoachQuestions,
  loadCoachQuestion,
  loadPendingCoachQuestion,
} from "./plans/coachQuestions.js";
import type { loadPlanDayCalories } from "./plans/dayCalories.js";
import type {
  createPeriodReviewComment,
  loadPeriodReview,
  loadPeriodReviews,
  markPeriodReviewReviewed,
  updatePeriodReviewComment,
} from "./plans/periodReviews.js";
import type {
  loadActivityFeedback,
  loadManualActivityReplies,
  loadWeeklyNoteReply,
} from "./plans/replies.js";
import type { PlanGenerationStore, PlanStore } from "./plans/store.js";
import type {
  PlanTriggerDependencies,
  triggerPlanGeneration,
} from "./plans/trigger.js";
import type { loadPlanWeekTotals } from "./plans/weekTotals.js";
import type { QuestionAnswerStore } from "./questions/answers.js";
import type { CoachingSurveyAdjustmentStore } from "./questions/adjustments.js";
import type { AdminLlmCallsDependencies } from "./routes/adminLlmCalls.js";
import type { loadFitnessHistory } from "./training/history.js";
import type { estimateManualActivityTss } from "./training/manualTss.js";
import type { UserStore } from "./users/store.js";
import type { searchLocations } from "./weather/geocode.js";

/**
 * The stores and injectable functions behind the app. Every field is optional:
 * a test supplies only the dependency it exercises and a route fills the rest
 * with its production default.
 *
 * The optional fields are typed `T | undefined` on purpose. Under
 * `exactOptionalPropertyTypes` that is what lets a caller forward the whole bag
 * — `loadX: deps.loadX` — without guarding every property with a conditional
 * spread. Pass the value through; let the consumer apply its own default.
 */
export interface AppDependencies {
  /** Auth provider, or a lazy getter resolved per request. */
  authProvider?: AuthProvider | (() => AuthProvider) | undefined;
  /** Account store used for role checks and first-user provisioning. */
  userStore?: UserStore | undefined;
  /** Athlete answer storage, injectable for DB-free route tests. */
  answerStore?: QuestionAnswerStore | undefined;
  /** Pending survey adjustments, injectable for DB-free plan route tests. */
  coachingSurveyAdjustments?: CoachingSurveyAdjustmentStore | undefined;
  /** Stored coach plan and generation progress, injectable for route tests. */
  planStore?: PlanStore | undefined;
  generationStore?: PlanGenerationStore | undefined;
  /** Activity/LLM loaders, injectable for DB-free plan route tests. */
  loadActivities?: ((userId: number) => Promise<ActivityFeed>) | undefined;
  loadThresholdHistory?: typeof loadThresholdHistoryForUser | undefined;
  loadBodyHistory?: typeof loadBodyHistoryForUser | undefined;
  /** Injectable for route tests; defaults to the stored daily health series. */
  loadDailyHealth?: typeof loadDailyHealthForUser | undefined;
  /** Injectable for route tests; defaults to the coach reading the text. */
  syncAthleteMetrics?: typeof syncAthleteMetrics | undefined;
  /** Injectable for route tests; defaults to the coach reading the text. */
  syncAthleteEvents?: typeof syncAthleteEvents | undefined;
  /** Stored dated goals and events, injectable for DB-free route tests. */
  loadEvents?: typeof loadAthleteEvents | undefined;
  /** Stored weekly plan totals, injectable for DB-free route tests. */
  loadWeekTotals?: typeof loadPlanWeekTotals | undefined;
  /** Stored daily calorie targets, injectable for DB-free route tests. */
  loadDayCalories?: typeof loadPlanDayCalories | undefined;
  /** Stored food log for the coaching and plan prompts. */
  loadDiet?: typeof loadDietContext | undefined;
  loadCachedFeed?: typeof loadCachedActivityFeed | undefined;
  /** Injectable for route tests; defaults to the stored activity feedback. */
  loadActivityFeedback?: typeof loadActivityFeedback | undefined;
  loadActivityTrainingLoads?: typeof loadUserActivityTrainingLoads | undefined;
  loadFitnessHistory?: typeof loadFitnessHistory | undefined;
  estimateManualTss?: typeof estimateManualActivityTss | undefined;
  loadLlm?: ((userId: number) => Promise<LlmClient | null>) | undefined;
  /** Stored meals, injectable for DB-free diet route tests. */
  dietEntries?: FoodEntryStore | undefined;
  /** Food-analysis prompt context, injectable for DB-free diet route tests. */
  loadFoodContext?:
    ((input: ReplyContextInput) => Promise<PlanContextInput>) | undefined;
  /** Food-analysis generator, injectable for DB-free diet route tests. */
  analyzeFood?: typeof analyzeFood | undefined;
  /** Meal-thumbnail generator, injectable for DB-free diet route tests. */
  createMealThumbnail?: typeof createMealThumbnail | undefined;
  /** Coaching-input loader, injectable for DB-free route tests. */
  loadCoachingInputs?:
    | ((userId: number, weekStartDate: string) => Promise<CoachingInputs>)
    | undefined;
  /** Coaching-input readers and writers, injectable for DB-free route tests. */
  loadManualActivities?: typeof loadManualActivities | undefined;
  loadWeeklyNote?: typeof loadWeeklyNote | undefined;
  createActivityComment?: typeof createActivityComment | undefined;
  updateActivityComment?: typeof updateActivityComment | undefined;
  saveActivityReview?: typeof saveActivityReview | undefined;
  loadPeriodReviews?: typeof loadPeriodReviews | undefined;
  loadPeriodReview?: typeof loadPeriodReview | undefined;
  createPeriodReviewComment?: typeof createPeriodReviewComment | undefined;
  updatePeriodReviewComment?: typeof updatePeriodReviewComment | undefined;
  markPeriodReviewReviewed?: typeof markPeriodReviewReviewed | undefined;
  loadPendingCoachQuestion?: typeof loadPendingCoachQuestion | undefined;
  loadAnsweredCoachQuestions?: typeof loadAnsweredCoachQuestions | undefined;
  loadCoachQuestion?: typeof loadCoachQuestion | undefined;
  answerCoachQuestion?: typeof answerCoachQuestion | undefined;
  saveManualActivity?: typeof saveManualActivity | undefined;
  saveWeeklyNote?: typeof saveWeeklyNote | undefined;
  updateManualActivity?: typeof updateManualActivity | undefined;
  deleteImportedActivity?: typeof deleteImportedActivity | undefined;
  deleteManualActivity?: typeof deleteManualActivity | undefined;
  /** Coach replies and their loaders, injectable for DB-free route tests. */
  loadManualActivityReplies?: typeof loadManualActivityReplies | undefined;
  loadWeeklyNoteReply?: typeof loadWeeklyNoteReply | undefined;
  replyToCoachingInput?: typeof replyToCoachingInput | undefined;
  replyToCoachQuestion?: typeof replyToCoachQuestion | undefined;
  answerCoachingQuestion?: typeof answerCoachingQuestion | undefined;
  /** Plan generation trigger, injectable for DB-free route tests. */
  triggerPlanGeneration?: typeof triggerPlanGeneration | undefined;
  /** Combined reply-and-plan run, injectable for DB-free route tests. */
  startCoachRun?: typeof startCoachRun | undefined;
  /** Address search, injectable for DB-free weather route tests. */
  searchLocations?: typeof searchLocations | undefined;
  /** Forecast loader, injectable for DB-free plan generation tests. */
  loadForecast?: PlanTriggerDependencies["loadForecast"] | undefined;
  /** Prompt log readers, injectable for DB-free admin route tests. */
  adminLlmCalls?: AdminLlmCallsDependencies | undefined;
  /** Prompt-log failure marker, injectable for DB-free plan route tests. */
  markPlanPromptsFailed?:
    PlanTriggerDependencies["markPlanPromptsFailed"] | undefined;
}

/**
 * `AppDependencies` with the account stores resolved once by `createApp`, so
 * every route receives the same context and never has to pick a default store.
 */
export interface ResolvedAppDependencies extends AppDependencies {
  userStore: UserStore;
  answerStore: QuestionAnswerStore;
  coachingSurveyAdjustments: CoachingSurveyAdjustmentStore;
  planStore: PlanStore;
  generationStore: PlanGenerationStore;
}

/**
 * Maps the shared context onto the plan trigger's dependency names. Keeping the
 * mapping in one place means a new injectable is forwarded to plan generation
 * by adding it here, not in every route that can start a run.
 */
export function planTriggerDependencies(
  deps: ResolvedAppDependencies,
): PlanTriggerDependencies {
  return {
    users: deps.userStore,
    answers: deps.answerStore,
    plans: deps.planStore,
    generations: deps.generationStore,
    coachingSurveyAdjustments: deps.coachingSurveyAdjustments,
    loadActivities: deps.loadActivities,
    loadThresholdHistory: deps.loadThresholdHistory,
    loadBodyHistory: deps.loadBodyHistory,
    loadDailyHealth: deps.loadDailyHealth,
    syncAthleteMetrics: deps.syncAthleteMetrics,
    syncAthleteEvents: deps.syncAthleteEvents,
    loadEvents: deps.loadEvents,
    loadDiet: deps.loadDiet,
    loadAnsweredCoachQuestions: deps.loadAnsweredCoachQuestions,
    loadLlm: deps.loadLlm,
    loadCoachingInputs: deps.loadCoachingInputs,
    loadForecast: deps.loadForecast,
    markPlanPromptsFailed: deps.markPlanPromptsFailed,
  };
}
