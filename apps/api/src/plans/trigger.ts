import type { ActivityFeed } from "../coaching/activities.js";
import {
  DEFAULT_ACTIVITIES,
  loadAnalyzedActivities,
} from "../coaching/activities.js";
import type { LlmClient } from "../llm/client.js";
import { loadLlmClient } from "../llm/client.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { UserStore } from "../users/store.js";
import { startOfWeek } from "./dates.js";
import { runPlanGeneration } from "./generate.js";
import { loadCoachingInputs, type CoachingInputs } from "./inputs.js";
import { latestAnswerTimestamp } from "./status.js";
import type { PlanGenerationStore, PlanStore } from "./store.js";

export interface PlanTriggerDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  /** Injectable for route tests; defaults to a Garmin sync. */
  loadActivities?: (userId: number) => Promise<ActivityFeed>;
  /** Injectable for route tests; defaults to the stored OpenRouter config. */
  loadLlm?: () => Promise<LlmClient | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
}

/**
 * Starts a plan generation in the background. Called by the explicit generate
 * route and by the routes that edit activity comments, manual activities, and
 * weekly notes, so an edit behaves like a fresh visit to the app. Returns false
 * when a generation is already running.
 */
export async function triggerPlanGeneration(
  deps: PlanTriggerDependencies,
  options: {
    userId: number;
    today: string;
    timezone?: string;
    force?: boolean;
    includeTomorrow?: boolean;
  },
): Promise<boolean> {
  const { userId, today, timezone, force, includeTomorrow } = options;
  if (!(await deps.generations.begin(userId))) {
    return false;
  }

  let plan: Awaited<ReturnType<PlanStore["load"]>>;
  let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  let activities: ActivityFeed;
  let llm: LlmClient | null;
  let coachingInputs: CoachingInputs;

  try {
    [plan, answers, activities, llm, coachingInputs] = await Promise.all([
      deps.plans.load(userId),
      deps.answers.listForUser(userId),
      deps.loadActivities
        ? deps.loadActivities(userId)
        : loadAnalyzedActivities({
            userId,
            limit: DEFAULT_ACTIVITIES,
            refresh: false,
          }),
      deps.loadLlm ? deps.loadLlm() : loadLlmClient(),
      deps.loadCoachingInputs
        ? deps.loadCoachingInputs(userId, startOfWeek(today))
        : loadCoachingInputs(userId, startOfWeek(today)),
    ]);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The plan could not be generated.";
    await deps.generations.fail(userId, message);
    throw err;
  }

  if (!llm) {
    const message = "OpenRouter is not configured. Add a key and model first.";
    await deps.generations.fail(userId, message);
    return true;
  }

  // Run the long cascade after responding so the request cannot hit the server
  // idle timeout. The client polls GET for progress.
  void runPlanGeneration({
    userId,
    today,
    ...(timezone !== undefined ? { timezone } : {}),
    ...(force !== undefined ? { force } : {}),
    ...(includeTomorrow !== undefined ? { includeTomorrow } : {}),
    plan,
    context: {
      answers,
      answersUpdatedAt: latestAnswerTimestamp(answers),
      activities: activities.activities,
      manualActivities: coachingInputs.manualActivities,
      activityComments: coachingInputs.activityComments,
      weeklyNote: coachingInputs.weeklyNote,
      coachingInputsUpdatedAt: coachingInputs.updatedAt,
      provider: llm.provider,
      apiKey: llm.apiKey,
      model: llm.model,
    },
    plans: deps.plans,
    generations: deps.generations,
  }).catch((err: unknown) => {
    console.error("[plan] background generation failed:", err);
  });

  return true;
}
