import {
  loadAnalyzedActivities,
  loadUserActivityTrainingLoads,
  type ActivityFeed,
} from "../../coaching/activities.js";
import {
  deleteImportedActivity,
  deleteManualActivity,
} from "../../coaching/deletions.js";
import {
  startCoachRun,
  type CoachRunDependencies,
} from "../../coaching/coachRun.js";
import {
  loadCachedActivityFeed,
  MAX_ANALYZED_ACTIVITIES,
} from "../../coaching/feedCache.js";
import {
  answerCoachingQuestion,
  replyToCoachQuestion,
  replyToCoachingInput,
  type CoachingReplyRequest,
} from "../../coaching/replies.js";
import { saveActivityReview } from "../../coaching/reviews.js";
import { loadLlmClient, type LlmClient } from "../../llm/client.js";
import { loadThresholdHistoryForUser } from "../../metrics/store.js";
import { estimateManualActivityTss } from "../../training/manualTss.js";
import {
  createActivityComment,
  loadManualActivities,
  loadWeeklyNote,
  saveManualActivity,
  saveWeeklyNote,
  updateActivityComment,
  updateManualActivity,
  type CoachingInputs,
} from "../../plans/inputs.js";
import {
  createPeriodReviewComment,
  loadPeriodReview,
  loadPeriodReviews,
  markPeriodReviewReviewed,
  updatePeriodReviewComment,
} from "../../plans/periodReviews.js";
import {
  answerCoachQuestion,
  loadAnsweredCoachQuestions,
  loadCoachQuestion,
  loadPendingCoachQuestion,
} from "../../plans/coachQuestions.js";
import {
  loadActivityFeedback,
  loadManualActivityReplies,
  loadWeeklyNoteReply,
  toCoachAnalysis,
} from "../../plans/replies.js";
import type { PlanGenerationStore, PlanStore } from "../../plans/store.js";
import {
  triggerPlanGeneration,
  type PlanTriggerDependencies,
} from "../../plans/trigger.js";
import type { QuestionAnswerStore } from "../../questions/answers.js";
import type { CoachingSurveyAdjustmentStore } from "../../questions/adjustments.js";
import type { UserStore } from "../../users/store.js";
import type { CoachAnalysis } from "@killingit/shared";

export interface CoachingRouteDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  /** Pending survey adjustments, injectable for DB-free route tests. */
  coachingSurveyAdjustments?: CoachingSurveyAdjustmentStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  loadActivities?: (userId: number, today?: string) => Promise<ActivityFeed>;
  /** Injectable for route tests; defaults to the stored feed reader. */
  loadCachedFeed?: typeof loadCachedActivityFeed;
  /** Injectable for route tests; defaults to the stored activity feedback. */
  loadActivityFeedback?: typeof loadActivityFeedback;
  /** Injectable for route tests; defaults to the training-load builder. */
  loadActivityTrainingLoads?: typeof loadUserActivityTrainingLoads;
  /** Injectable for route tests; defaults to the LLM TSS estimator. */
  estimateManualTss?: typeof estimateManualActivityTss;
  /** Injectable for route tests; defaults to the stored threshold timelines. */
  loadThresholdHistory?: typeof loadThresholdHistoryForUser;
  loadLlm?: (userId: number) => Promise<LlmClient | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  /** Injectable for route tests; default to the database-backed writers. */
  loadWeeklyNote?: typeof loadWeeklyNote;
  loadManualActivities?: typeof loadManualActivities;
  loadManualActivityReplies?: typeof loadManualActivityReplies;
  loadWeeklyNoteReply?: typeof loadWeeklyNoteReply;
  createActivityComment?: typeof createActivityComment;
  updateActivityComment?: typeof updateActivityComment;
  saveActivityReview?: typeof saveActivityReview;
  loadPeriodReviews?: typeof loadPeriodReviews;
  loadPeriodReview?: typeof loadPeriodReview;
  createPeriodReviewComment?: typeof createPeriodReviewComment;
  updatePeriodReviewComment?: typeof updatePeriodReviewComment;
  markPeriodReviewReviewed?: typeof markPeriodReviewReviewed;
  loadPendingCoachQuestion?: typeof loadPendingCoachQuestion;
  loadAnsweredCoachQuestions?: typeof loadAnsweredCoachQuestions;
  loadCoachQuestion?: typeof loadCoachQuestion;
  answerCoachQuestion?: typeof answerCoachQuestion;
  saveManualActivity?: typeof saveManualActivity;
  saveWeeklyNote?: typeof saveWeeklyNote;
  updateManualActivity?: typeof updateManualActivity;
  deleteImportedActivity?: typeof deleteImportedActivity;
  deleteManualActivity?: typeof deleteManualActivity;
  /** Injectable for route tests; defaults to the real coach reply generator. */
  replyToCoachingInput?: typeof replyToCoachingInput;
  /** Injectable for route tests; defaults to the real coach-question reply. */
  replyToCoachQuestion?: typeof replyToCoachQuestion;
  /** Injectable for route tests; defaults to the real one-off question answer. */
  answerCoachingQuestion?: typeof answerCoachingQuestion;
  /** Injectable for route tests; defaults to the real plan generation trigger. */
  triggerPlanGeneration?: typeof triggerPlanGeneration;
  /** Injectable for route tests; defaults to the combined reply-and-plan run. */
  startCoachRun?: typeof startCoachRun;
  /** Injectable for route tests; defaults to Open-Meteo. */
  loadForecast?: PlanTriggerDependencies["loadForecast"];
  /** Injectable for route tests; defaults to the stored food log. */
  loadDiet?: PlanTriggerDependencies["loadDiet"];
}

/**
 * The stores and injectable functions every coaching handler shares. Missing
 * dependencies are filled with their database-backed defaults once, when the
 * route is created.
 */
export interface ResolvedCoachingDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  loadActivities: (userId: number, today?: string) => Promise<ActivityFeed>;
  loadCachedFeed: typeof loadCachedActivityFeed;
  loadFeedback: typeof loadActivityFeedback;
  loadActivityTrainingLoads: typeof loadUserActivityTrainingLoads;
  estimateTss: typeof estimateManualActivityTss;
  createComment: typeof createActivityComment;
  updateComment: typeof updateActivityComment;
  saveReview: typeof saveActivityReview;
  loadReviews: typeof loadPeriodReviews;
  loadReview: typeof loadPeriodReview;
  createReviewComment: typeof createPeriodReviewComment;
  updateReviewComment: typeof updatePeriodReviewComment;
  markReviewReviewed: typeof markPeriodReviewReviewed;
  saveManual: typeof saveManualActivity;
  saveWeekly: typeof saveWeeklyNote;
  loadNote: typeof loadWeeklyNote;
  loadNoteReply: typeof loadWeeklyNoteReply;
  loadManual: typeof loadManualActivities;
  loadManualReplies: typeof loadManualActivityReplies;
  updateManual: typeof updateManualActivity;
  deleteImported: typeof deleteImportedActivity;
  deleteManual: typeof deleteManualActivity;
  reply: typeof replyToCoachingInput;
  replyToQuestion: typeof replyToCoachQuestion;
  answerQuestion: typeof answerCoachingQuestion;
  loadPendingQuestion: typeof loadPendingCoachQuestion;
  loadAnsweredQuestions: typeof loadAnsweredCoachQuestions;
  loadQuestion: typeof loadCoachQuestion;
  answerCoachQuestionStore: typeof answerCoachQuestion;
  trigger: typeof triggerPlanGeneration;
  llmLoader: (userId: number) => Promise<LlmClient | null>;
  loadThresholds: typeof loadThresholdHistoryForUser;
  triggerDeps: PlanTriggerDependencies;
  coachRunDeps: CoachRunDependencies;
  startRun: typeof startCoachRun;
}

/** Fills every optional dependency with the production implementation. */
export function resolveCoachingDependencies(
  deps: CoachingRouteDependencies,
): ResolvedCoachingDependencies {
  const loadActivities =
    deps.loadActivities ??
    ((userId, today) =>
      loadAnalyzedActivities({
        userId,
        // Analyse the newest activities the cap allows, but return every
        // activity in the stored history.
        limit: MAX_ANALYZED_ACTIVITIES,
        refresh: false,
        ...(today !== undefined ? { today } : {}),
      }));
  const llmLoader = deps.loadLlm ?? loadLlmClient;
  const loadAnsweredQuestions =
    deps.loadAnsweredCoachQuestions ?? loadAnsweredCoachQuestions;

  const triggerDeps: PlanTriggerDependencies = {
    users: deps.users,
    answers: deps.answers,
    plans: deps.plans,
    generations: deps.generations,
    ...(deps.coachingSurveyAdjustments !== undefined
      ? { coachingSurveyAdjustments: deps.coachingSurveyAdjustments }
      : {}),
    ...(deps.loadActivities !== undefined
      ? { loadActivities: deps.loadActivities }
      : {}),
    ...(deps.loadLlm !== undefined ? { loadLlm: deps.loadLlm } : {}),
    ...(deps.loadCoachingInputs !== undefined
      ? { loadCoachingInputs: deps.loadCoachingInputs }
      : {}),
    ...(deps.loadForecast !== undefined
      ? { loadForecast: deps.loadForecast }
      : {}),
    ...(deps.loadThresholdHistory !== undefined
      ? { loadThresholdHistory: deps.loadThresholdHistory }
      : {}),
    ...(deps.loadDiet !== undefined ? { loadDiet: deps.loadDiet } : {}),
    loadAnsweredCoachQuestions: loadAnsweredQuestions,
  };
  const coachRunDeps: CoachRunDependencies = {
    ...triggerDeps,
    loadLlm: llmLoader,
  };

  return {
    users: deps.users,
    answers: deps.answers,
    plans: deps.plans,
    generations: deps.generations,
    loadActivities,
    loadCachedFeed: deps.loadCachedFeed ?? loadCachedActivityFeed,
    loadFeedback: deps.loadActivityFeedback ?? loadActivityFeedback,
    loadActivityTrainingLoads:
      deps.loadActivityTrainingLoads ?? loadUserActivityTrainingLoads,
    estimateTss: deps.estimateManualTss ?? estimateManualActivityTss,
    createComment: deps.createActivityComment ?? createActivityComment,
    updateComment: deps.updateActivityComment ?? updateActivityComment,
    saveReview: deps.saveActivityReview ?? saveActivityReview,
    loadReviews: deps.loadPeriodReviews ?? loadPeriodReviews,
    loadReview: deps.loadPeriodReview ?? loadPeriodReview,
    createReviewComment:
      deps.createPeriodReviewComment ?? createPeriodReviewComment,
    updateReviewComment:
      deps.updatePeriodReviewComment ?? updatePeriodReviewComment,
    markReviewReviewed:
      deps.markPeriodReviewReviewed ?? markPeriodReviewReviewed,
    saveManual: deps.saveManualActivity ?? saveManualActivity,
    saveWeekly: deps.saveWeeklyNote ?? saveWeeklyNote,
    loadNote: deps.loadWeeklyNote ?? loadWeeklyNote,
    loadNoteReply: deps.loadWeeklyNoteReply ?? loadWeeklyNoteReply,
    loadManual: deps.loadManualActivities ?? loadManualActivities,
    loadManualReplies:
      deps.loadManualActivityReplies ?? loadManualActivityReplies,
    updateManual: deps.updateManualActivity ?? updateManualActivity,
    deleteImported: deps.deleteImportedActivity ?? deleteImportedActivity,
    deleteManual: deps.deleteManualActivity ?? deleteManualActivity,
    reply: deps.replyToCoachingInput ?? replyToCoachingInput,
    replyToQuestion: deps.replyToCoachQuestion ?? replyToCoachQuestion,
    answerQuestion: deps.answerCoachingQuestion ?? answerCoachingQuestion,
    loadPendingQuestion:
      deps.loadPendingCoachQuestion ?? loadPendingCoachQuestion,
    loadAnsweredQuestions,
    loadQuestion: deps.loadCoachQuestion ?? loadCoachQuestion,
    answerCoachQuestionStore: deps.answerCoachQuestion ?? answerCoachQuestion,
    trigger: deps.triggerPlanGeneration ?? triggerPlanGeneration,
    llmLoader,
    loadThresholds: deps.loadThresholdHistory ?? loadThresholdHistoryForUser,
    triggerDeps,
    coachRunDeps,
    startRun: deps.startCoachRun ?? startCoachRun,
  };
}

/**
 * Asks the coach for a reply to one athlete input and returns it in the shape
 * the web app renders. A provider failure is the reply generator's concern; a
 * null result means no reply was stored.
 */
export async function replyTo(
  deps: ResolvedCoachingDependencies,
  userId: number,
  today: string,
  request: CoachingReplyRequest,
): Promise<CoachAnalysis | null> {
  const stored = await deps.reply(
    { plans: deps.plans, answers: deps.answers, loadLlm: deps.llmLoader },
    { userId, today, request },
  );
  return stored === null ? null : toCoachAnalysis(stored);
}
