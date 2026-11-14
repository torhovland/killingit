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
  loadStoredActivityFeed,
  MAX_ANALYZED_ACTIVITIES,
} from "../../coaching/activityStore.js";
import {
  answerCoachingQuestion,
  replyToCoachQuestion,
  replyToCoachingInput,
  type CoachingReplyRequest,
} from "../../coaching/replies.js";
import { saveActivityReview } from "../../coaching/reviews.js";
import {
  planTriggerDependencies,
  type ResolvedAppDependencies,
} from "../../dependencies.js";
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
import type { CoachAnalysis } from "@killingit/shared";

/**
 * The stores and injectable functions every coaching handler shares. Missing
 * dependencies are filled with their database-backed defaults once, when the
 * route is created.
 */
export interface ResolvedCoachingDependencies {
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  loadActivities: (
    userId: number,
    today?: string,
    timezone?: string,
  ) => Promise<ActivityFeed>;
  loadStoredFeed: typeof loadStoredActivityFeed;
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
  deps: ResolvedAppDependencies,
): ResolvedCoachingDependencies {
  const loadActivities =
    deps.loadActivities ??
    ((userId: number, today?: string, timezone?: string) =>
      loadAnalyzedActivities({
        userId,
        // Analyse the newest activities the cap allows, but return every
        // activity in the stored history.
        limit: MAX_ANALYZED_ACTIVITIES,
        refresh: false,
        ...(today !== undefined ? { today } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
      }));
  const llmLoader = deps.loadLlm ?? loadLlmClient;
  const loadAnsweredQuestions =
    deps.loadAnsweredCoachQuestions ?? loadAnsweredCoachQuestions;

  const triggerDeps: PlanTriggerDependencies = {
    ...planTriggerDependencies(deps),
    loadAnsweredCoachQuestions: loadAnsweredQuestions,
  };
  const coachRunDeps: CoachRunDependencies = {
    ...triggerDeps,
    loadLlm: llmLoader,
  };

  return {
    answers: deps.answerStore,
    plans: deps.planStore,
    generations: deps.generationStore,
    loadActivities,
    loadStoredFeed: deps.loadStoredFeed ?? loadStoredActivityFeed,
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
  timezone: string | undefined,
  request: CoachingReplyRequest,
): Promise<CoachAnalysis | null> {
  const stored = await deps.reply(
    { plans: deps.plans, answers: deps.answers, loadLlm: deps.llmLoader },
    { userId, today, ...(timezone !== undefined ? { timezone } : {}), request },
  );
  return stored === null ? null : toCoachAnalysis(stored);
}
