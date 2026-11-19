import { loadAnalyzedActivities } from "../coaching/activities.js";
import type { ActivityFeed } from "../coaching/feed/presenter.js";
import { MAX_ANALYZED_ACTIVITIES } from "../coaching/activityStore.js";
import {
  buildAthleteReadingSource,
  syncAthleteReading,
} from "../coaching/athleteReading.js";
import { loadLlmClient, type LlmClient } from "../llm/client.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import {
  dbCoachingSurveyAdjustmentStore,
  type CoachingSurveyAdjustmentStore,
} from "../questions/adjustments.js";
import { ftpHistoryPoints } from "../training/thresholds.js";
import type { UserStore } from "../users/store.js";
import {
  startOfWeek,
  type AnalyzedActivity,
  type AthleteLocation,
} from "@killingit/shared";
import { athleteTextChanged } from "./athleteText.js";
import { loadAnsweredCoachQuestions } from "./coachQuestions.js";
import { planFailureMessage } from "./failure.js";
import { GenerationSupersededError } from "./generation.js";
import { ensureGenerationCurrent } from "./generation/persist.js";
import type { PlanGenerationContext } from "./generation/types.js";
import { loadCoachingInputs, type CoachingInputs } from "./inputs.js";
import type { PlanInputs } from "./planInputs.js";
import {
  latestActivityAnalysisTimestamp,
  latestAnswerTimestamp,
  latestPlanChangingAnalysisTimestamp,
} from "./status.js";
import { PLAN_GENERATION_STEPS } from "./steps.js";
import { loadValidatedPlan, type StoredPlan } from "./store.js";
import type { PlanRunOptions, PlanTriggerDependencies } from "./trigger.js";

/** The failure an account without a configured model reports. */
const LLM_NOT_CONFIGURED_MESSAGE =
  "OpenRouter is not configured. Add a key and model first.";

/**
 * Everything a plan run reads before it enriches its prompt. The advisory
 * inputs (`loadPlanInputs`) are read after this, once the account and the feed
 * are known.
 */
export interface LoadedPlanGenerationContext {
  /** The stored plan, checked against the current schema; null if absent. */
  plan: StoredPlan | null;
  answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  activities: ActivityFeed;
  /** The account's configured model. A run never starts without one. */
  llm: LlmClient;
  coachingInputs: CoachingInputs;
  user: Awaited<ReturnType<UserStore["getById"]>>;
  coachAnswers: Awaited<ReturnType<typeof loadAnsweredCoachQuestions>>;
  surveyAdjustments: Awaited<
    ReturnType<CoachingSurveyAdjustmentStore["listForUser"]>
  >;
  /** The store the run clears the adjustments it consumed from. */
  surveyAdjustmentStore: CoachingSurveyAdjustmentStore;
  /** When the feed was requested, so a newer analysis pass can be noticed. */
  activitiesSnapshotAt: number;
}

/**
 * Prepares one plan run: checks the model, loads the activity feed and reads
 * the account's own state. The caller has already claimed the generation row
 * and owns the heartbeat.
 *
 * The model credentials are checked before the Garmin sync, a fast read ahead
 * of a slow one, so an account without a key is told now rather than after a
 * full sync. The run's failure handling is fenced here: an aborted run throws
 * `GenerationSupersededError` without writing, and any other failure marks the
 * generation failed and rethrows. Returns `null` when the account has no model;
 * the row then already carries the reason.
 */
export async function loadPlanGenerationContext(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions & { runId: string; signal: AbortSignal },
): Promise<LoadedPlanGenerationContext | null> {
  const { userId, today, timezone } = options;
  const activitiesSnapshotAt = Date.now();
  const preloadedActivities = deps.loadActivities;
  const surveyAdjustmentStore =
    deps.coachingSurveyAdjustments ?? dbCoachingSurveyAdjustmentStore;

  try {
    const llm = deps.loadLlm
      ? await deps.loadLlm(userId)
      : await loadLlmClient(userId, "all");
    if (llm === null) {
      await deps.generations.fail(
        userId,
        LLM_NOT_CONFIGURED_MESSAGE,
        options.runId,
      );
      return null;
    }

    // A real plan run owns the Garmin sync, so name that phase separately from
    // the fast database reads that follow. A caller that already holds the
    // analysed feed has nothing to sync.
    if (preloadedActivities === undefined) {
      await deps.generations.update(
        userId,
        PLAN_GENERATION_STEPS.syncActivities,
        options.runId,
      );
    }
    const activities =
      preloadedActivities !== undefined
        ? await preloadedActivities(userId)
        : await loadAnalyzedActivities({
            userId,
            // The sidecar syncs 42 days. Analyse the newest activities the
            // cap allows; the plan prompt reviews the same recent window.
            limit: MAX_ANALYZED_ACTIVITIES,
            refresh: false,
            // Key the pass by the plan's own day so it shares a dashboard
            // request for the same day and never adopts another day's feed.
            today,
            timezone,
          });
    if (preloadedActivities === undefined) {
      await deps.generations.update(
        userId,
        PLAN_GENERATION_STEPS.prepare,
        options.runId,
      );
    }

    const [
      plan,
      answers,
      coachingInputs,
      user,
      coachAnswers,
      surveyAdjustments,
    ] = await Promise.all([
      // A row written under an older schema is treated as absent, so the run
      // rebuilds the plan instead of prompting from a body it cannot read.
      loadValidatedPlan(deps.plans, userId),
      deps.answers.listForUser(userId),
      deps.loadCoachingInputs
        ? deps.loadCoachingInputs(userId, startOfWeek(today))
        : loadCoachingInputs(userId, startOfWeek(today)),
      deps.users.getById(userId),
      (deps.loadAnsweredCoachQuestions ?? loadAnsweredCoachQuestions)(userId),
      surveyAdjustmentStore.listForUser(userId),
    ]);

    return {
      plan,
      answers,
      activities,
      llm,
      coachingInputs,
      user,
      coachAnswers,
      surveyAdjustments,
      surveyAdjustmentStore,
      activitiesSnapshotAt,
    };
  } catch (err) {
    if (options.signal.aborted) {
      throw new GenerationSupersededError();
    }
    await deps.generations.fail(userId, planFailureMessage(err), options.runId);
    throw err;
  }
}

/** The dependencies the athlete-reading phase reads. */
type AthleteReadingDependencies = Pick<
  PlanTriggerDependencies,
  "syncAthleteReading" | "generations"
>;

/**
 * Reads the athlete's own words when the last plan build did not. A new day, a
 * forecast change or a new synced activity does not change what the athlete
 * wrote, so the model task is skipped. The run is fenced afterwards because the
 * reading is slow enough for a newer run to supersede it.
 */
export async function syncAthleteReadingIfChanged(
  deps: AthleteReadingDependencies,
  loaded: LoadedPlanGenerationContext,
  run: PlanRunOptions & { runId: string; signal: AbortSignal },
): Promise<void> {
  const { userId, today, runId, signal } = run;
  const { plan, answers, coachingInputs, coachAnswers, llm } = loaded;
  const shouldRead = athleteTextChanged({
    planGeneratedAt: plan?.generatedAt ?? null,
    planAnswersUpdatedAt: plan?.answersUpdatedAt ?? null,
    planCoachingInputsUpdatedAt: plan?.coachingInputsUpdatedAt ?? null,
    answers,
    coachingInputsUpdatedAt: coachingInputs.updatedAt,
    coachAnswers,
  });
  if (!shouldRead) {
    return;
  }
  // One reading covers the measurements, goals and events the athlete states
  // in their own words. Reading is a model task, not a phrase list.
  await (deps.syncAthleteReading ?? syncAthleteReading)({
    userId,
    today,
    source: buildAthleteReadingSource(
      {
        answers,
        activityComments: coachingInputs.activityComments,
        manualActivities: coachingInputs.manualActivities,
        weeklyNotes: coachingInputs.weeklyNotes ?? [],
        periodReviews: coachingInputs.periodReviews,
        coachQuestionAnswers: coachAnswers.map((answer) => ({
          question: answer.question,
          answer: answer.answer ?? "",
          answeredAt: answer.answeredAt,
        })),
      },
      today,
    ),
    provider: llm.provider,
    credentials: {
      apiKey: llm.apiKey,
      model: llm.dailyModel,
      signal,
    },
  });
  await ensureGenerationCurrent({
    userId,
    runId,
    signal,
    generations: deps.generations,
  });
}

/** Everything a run read before it assembles the prompt context. */
export interface PlanContextBuild {
  /** The required inputs `loadPlanGenerationContext` read. */
  loaded: LoadedPlanGenerationContext;
  /** Every stored activity, so the load series has its full warm-up. */
  activities: readonly AnalyzedActivity[];
  /** The activity window the prompt reviews, after any newer analysis pass. */
  recentActivities: readonly AnalyzedActivity[];
  /** The advisory inputs `loadPlanInputs` read. */
  inputs: PlanInputs;
  /** The request's zone, falling back to the athlete's stored zone. */
  timeZone: string | null;
  /** The athlete's home location, or null when none is stored. */
  location: AthleteLocation | null;
  signal: AbortSignal;
}

/**
 * Assembles the one context every plan prompt reads. The loaded and advisory
 * inputs keep their own shapes; this function only renames them and derives
 * the timestamps the prompt compares against the stored plan, so the mapping
 * lives in one place with its own test instead of inside the run.
 */
export function buildPlanContext(
  input: PlanContextBuild,
): PlanGenerationContext {
  const { loaded, inputs } = input;
  const { coachingInputs, llm } = loaded;
  return {
    answers: loaded.answers,
    answersUpdatedAt: latestAnswerTimestamp(loaded.answers),
    activities: input.activities,
    recentActivities: input.recentActivities,
    manualActivities: coachingInputs.manualActivities,
    activityComments: coachingInputs.activityComments,
    weeklyNote: coachingInputs.weeklyNote,
    weeklyNoteWeekStartDate: coachingInputs.weeklyNoteWeekStartDate,
    weeklyNoteReply: coachingInputs.weeklyNoteReply,
    weeklyNoteUpdatedAt: coachingInputs.weeklyNoteUpdatedAt,
    periodReviews: coachingInputs.periodReviews,
    weekReviewUpdatedAt: coachingInputs.weekReviewUpdatedAt,
    blockReviewUpdatedAt: coachingInputs.blockReviewUpdatedAt,
    coachingInputsUpdatedAt: coachingInputs.updatedAt,
    coachingInputsRefreshUpdatedAt: coachingInputs.refreshUpdatedAt,
    weekReviewNeedsRefresh: coachingInputs.weekReviewNeedsRefresh,
    blockReviewNeedsRefresh: coachingInputs.blockReviewNeedsRefresh,
    coachingSurveyAdjustments: loaded.surveyAdjustments,
    activitiesUpdatedAt: latestActivityAnalysisTimestamp(
      input.recentActivities,
    ),
    activitiesRefreshUpdatedAt: latestPlanChangingAnalysisTimestamp(
      input.recentActivities,
    ),
    timeZone: input.timeZone,
    location: input.location,
    forecast: inputs.forecast,
    weatherForecasts: inputs.weatherForecasts,
    ftpHistory: ftpHistoryPoints(inputs.thresholdHistory.timelines),
    thresholds: inputs.thresholdHistory.summaries,
    thresholdTimelines: inputs.thresholdHistory.timelines,
    bodyHistory: inputs.bodyHistory,
    dailyHealth: inputs.dailyHealth,
    events: inputs.events,
    diet: inputs.diet ?? undefined,
    dietGoal: loaded.plan?.plan.diet ?? null,
    dietAdvice: loaded.user?.dietAdvice ?? false,
    calorieHistory: inputs.calorieHistory,
    provider: llm.provider,
    apiKey: llm.apiKey,
    seasonModel: llm.seasonModel,
    dailyModel: llm.dailyModel,
    signal: input.signal,
  };
}
