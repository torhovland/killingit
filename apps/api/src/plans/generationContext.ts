import type { ActivityFeed } from "../coaching/activities.js";
import { loadAnalyzedActivities } from "../coaching/activities.js";
import { MAX_ANALYZED_ACTIVITIES } from "../coaching/activityStore.js";
import { loadLlmClient, type LlmClient } from "../llm/client.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import {
  dbCoachingSurveyAdjustmentStore,
  type CoachingSurveyAdjustmentStore,
} from "../questions/adjustments.js";
import type { UserStore } from "../users/store.js";
import { startOfWeek } from "@killingit/shared";
import { loadAnsweredCoachQuestions } from "./coachQuestions.js";
import { GenerationSupersededError } from "./generation.js";
import { loadCoachingInputs, type CoachingInputs } from "./inputs.js";
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
            ...(timezone !== undefined ? { timezone } : {}),
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
    const message =
      err instanceof Error ? err.message : "The plan could not be generated.";
    await deps.generations.fail(userId, message, options.runId);
    throw err;
  }
}
