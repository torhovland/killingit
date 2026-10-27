import {
  recordedPowerSummary,
  type Activity,
  type ActivitySummary,
  type AnalyzedActivity,
  type CoachPlan,
  type RoutePoint,
  type TrainingLoad,
} from "@killingit/shared";
import { decrypt } from "../crypto/credentials.js";
import { syncGarminActivities } from "../garmin/client.js";
import { loadDeletedActivityIds } from "./deletions.js";
import { loadDecryptedGarminCredentials } from "../garmin/credentials.js";
import { mapWithConcurrency } from "../lib/mapWithConcurrency.js";
import { ANALYSIS_PROMPT_VERSION } from "../llm/activityPrompt.js";
import { analyzeActivity } from "../llm/analyze.js";
import {
  loadAnalyses,
  saveAnalysis,
  type StoredAnalysis,
} from "../llm/analysisStore.js";
import { PROGRAM_ANALYSIS_PROMPT_VERSION } from "../llm/programAnalysisPrompt.js";
import {
  loadActivityFeedback,
  toCoachAnalysis,
  type ActivityFeedback,
} from "../plans/replies.js";
import { llmCredentialsKeyFromEnv } from "../llm/credentials.js";
import {
  createOpenRouterProvider,
  LlmAuthError,
  LlmProviderError,
  type LlmProvider,
} from "../llm/openrouter.js";
import { loadLlmSettings } from "../llm/store.js";
import { startOfWeek } from "../plans/dates.js";
import { loadCoachingInputs } from "../plans/inputs.js";
import { latestAnswerTimestamp } from "../plans/status.js";
import { dbPlanStore } from "../plans/store.js";
import { dbQuestionAnswerStore } from "../questions/answers.js";
import { buildActivityTrainingLoads } from "../training/activityLoad.js";
import { buildFtpTimeline } from "../training/ftp.js";
import { saveCachedActivityFeed } from "./feedCache.js";
import { routeFromSamples } from "./route.js";

/** How many of the latest synced activities can be returned in one feed. */
export const MAX_ACTIVITIES = 20;
export const DEFAULT_ACTIVITIES = 10;
/** Bounded concurrency so a batch does not flood OpenRouter. */
const ANALYSIS_CONCURRENCY = 3;

/** The account has not connected Garmin yet. */
export class GarminNotConnectedError extends Error {
  readonly status = 401;
  constructor() {
    super("Not connected to Garmin");
    this.name = "GarminNotConnectedError";
  }
}

/** The stored Garmin credentials could not be decrypted. */
export class GarminCredentialsError extends Error {
  readonly status = 503;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GarminCredentialsError";
  }
}

/** The stored LLM key could not be decrypted. */
export class LlmCredentialsError extends Error {
  readonly status = 503;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmCredentialsError";
  }
}

export interface ActivityFeed {
  model: string | null;
  activities: AnalyzedActivity[];
}

/**
 * Syncs the latest Garmin activities and returns them with cached-or-fresh
 * coach analyses. Before an LLM is configured, activities are returned without
 * analyses so the Garmin sync remains useful.
 */
export async function loadAnalyzedActivities(options: {
  userId: number;
  limit: number;
  refresh: boolean;
  provider?: LlmProvider;
}): Promise<ActivityFeed> {
  const provider = options.provider ?? createOpenRouterProvider();

  let garminCredentials;
  try {
    garminCredentials = await loadDecryptedGarminCredentials(options.userId);
  } catch (err) {
    throw new GarminCredentialsError(
      "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
      { cause: err },
    );
  }
  if (!garminCredentials) {
    throw new GarminNotConnectedError();
  }

  const activities = await syncGarminActivities(garminCredentials);
  const deletedIds = await loadDeletedActivityIds(options.userId, "garmin");
  const synced = [...activities]
    .filter((activity) => !deletedIds.has(String(activity.id)))
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
  const latest = synced.slice(0, options.limit);

  // Store the synced activities before the (potentially slow) LLM analyses so
  // a reload during analysis still shows the existing cards.
  await persistFeed(options.userId, {
    model: null,
    activities: latest.map((activity) => withoutAnalysis(activity)),
  });

  const [settings, feedback, storedPlan] = await Promise.all([
    loadLlmSettings(options.userId),
    loadActivityFeedback(
      options.userId,
      latest.map((activity) => activity.id),
    ),
    dbPlanStore.load(options.userId),
  ]);
  let loads = new Map<string, TrainingLoad>();
  try {
    loads = await loadUserActivityTrainingLoads(
      options.userId,
      synced.map((activity) => withoutAnalysis(activity)),
      storedPlan?.plan,
    );
  } catch (err) {
    // Load values are supplementary; the activity feed must still load.
    console.error("[training-load] could not score activities:", err);
  }
  if (!settings) {
    const feed: ActivityFeed = {
      model: null,
      activities: latest.map((activity) =>
        withActivityLoad(
          withoutAnalysis(activity, feedback.get(String(activity.id))),
          loads,
        ),
      ),
    };
    await persistFeed(options.userId, feed);
    return feed;
  }

  const analysisContext = storedPlan
    ? {
        today: storedPlan.plan.today.date,
        week: storedPlan.plan.week,
      }
    : undefined;

  let apiKey: string;
  try {
    const key = await llmCredentialsKeyFromEnv();
    apiKey = await decrypt(settings.apiKeyEncrypted, key);
  } catch (err) {
    throw new LlmCredentialsError(
      "OpenRouter credentials are unavailable (check LLM_CREDENTIALS_KEY)",
      { cause: err },
    );
  }

  const activityIds = latest.map((activity) => activity.id);
  const [cached, cachedProgram] = options.refresh
    ? [new Map<number, StoredAnalysis>(), new Map<number, StoredAnalysis>()]
    : await Promise.all([
        loadAnalyses(
          options.userId,
          activityIds,
          settings.model,
          ANALYSIS_PROMPT_VERSION,
        ),
        loadAnalyses(
          options.userId,
          activityIds,
          settings.model,
          PROGRAM_ANALYSIS_PROMPT_VERSION,
          "program",
        ),
      ]);

  const analysed = await mapWithConcurrency(
    latest,
    ANALYSIS_CONCURRENCY,
    async (activity): Promise<AnalyzedActivity> => {
      const activityFeedback = feedback.get(String(activity.id));
      const hit = cached.get(activity.id);
      const program = cachedProgram.get(activity.id) ?? null;
      if (hit) {
        return withStoredAnalysis(activity, hit, program, activityFeedback);
      }

      try {
        const text = await analyzeActivity(
          provider,
          { apiKey, model: settings.model },
          activity,
          analysisContext,
        );
        const saved = await saveAnalysis({
          userId: options.userId,
          activityId: activity.id,
          model: settings.model,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          text,
        });
        return withStoredAnalysis(activity, saved, program, activityFeedback);
      } catch (err) {
        // A revoked/invalid key affects every activity; surface it instead of
        // returning a list where every card says "analysis failed".
        if (err instanceof LlmAuthError) {
          throw err;
        }
        const detail =
          err instanceof LlmProviderError
            ? err.message
            : err instanceof Error
              ? err.name
              : "unknown error";
        console.error(
          `[coaching] analysis failed for activity ${activity.id}: ${detail}`,
        );
        return {
          ...summarize(activity),
          analysis: null,
          analysisError:
            err instanceof LlmProviderError
              ? err.message
              : "The coach analysis could not be saved.",
          programAnalysis: program ? toCoachAnalysis(program) : null,
          comment: activityFeedback?.comment ?? null,
          coachReply: activityFeedback?.reply
            ? toCoachAnalysis(activityFeedback.reply)
            : null,
          reviewed: activityFeedback?.reviewed ?? false,
        };
      }
    },
  );

  const feed: ActivityFeed = {
    model: settings.model,
    activities: analysed.map((activity) => withActivityLoad(activity, loads)),
  };
  await persistFeed(options.userId, feed);
  return feed;
}

/**
 * Builds the training-load snapshots for the synced activity dates. The FTP
 * timeline includes any revised test result the athlete mentioned, and the
 * stored plan supplies coach TSS estimates for the days it covers.
 */
export async function loadUserActivityTrainingLoads(
  userId: number,
  activities: readonly AnalyzedActivity[],
  plan: CoachPlan | undefined,
): Promise<Map<string, TrainingLoad>> {
  const planDate = plan?.today.date ?? new Date().toISOString().slice(0, 10);
  const [answers, coachingInputs] = await Promise.all([
    dbQuestionAnswerStore.listForUser(userId),
    loadCoachingInputs(userId, startOfWeek(planDate)),
  ]);
  const timeline = buildFtpTimeline({
    answers,
    answersUpdatedAt: latestAnswerTimestamp(answers),
    manualActivities: coachingInputs.manualActivities,
    activityComments: coachingInputs.activityComments,
    weeklyNote: coachingInputs.weeklyNote,
    weeklyNoteUpdatedAt: coachingInputs.weeklyNoteUpdatedAt,
    periodReviews: coachingInputs.periodReviews,
  });
  const tssByDate = planTssByDate(plan);
  // Manual entries are part of the same load history. Their stored estimates
  // replace the plan's estimate for the date and are summed when the athlete
  // logged more than one entry that day.
  const manualTssByDate = new Map<string, number>();
  for (const manual of coachingInputs.manualActivities) {
    if (manual.estimatedTss === null || manual.estimatedTss === undefined) {
      continue;
    }
    manualTssByDate.set(
      manual.startDate,
      (manualTssByDate.get(manual.startDate) ?? 0) + manual.estimatedTss,
    );
  }
  for (const [date, tss] of manualTssByDate) {
    tssByDate.set(date, tss);
  }
  return buildActivityTrainingLoads(activities, timeline, tssByDate);
}

/** The resolved or coach-estimated TSS for each day the stored plan covers. */
function planTssByDate(plan: CoachPlan | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (plan === undefined) {
    return result;
  }
  const sessions = [...plan.week.sessions, ...(plan.nextWeek?.sessions ?? [])];
  for (const session of sessions) {
    const tss = session.trainingLoad?.tss ?? session.estimatedTss;
    if (tss !== undefined) {
      result.set(session.date, tss);
    }
  }
  return result;
}

/** Attaches the day's resolved training load to an activity for the page. */
function withActivityLoad(
  activity: AnalyzedActivity,
  loads: ReadonlyMap<string, TrainingLoad>,
): AnalyzedActivity {
  return {
    ...activity,
    trainingLoad: loads.get(activity.startDate.slice(0, 10)) ?? null,
  };
}

/** Stores the feed for a fast first paint; a cache failure must not fail sync. */
async function persistFeed(userId: number, feed: ActivityFeed): Promise<void> {
  try {
    await saveCachedActivityFeed(userId, feed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[coaching] could not cache the activity feed: ${detail}`);
  }
}

/**
 * Strips the (large) timeseries, keeping the summary, its sample count, and a
 * bounded GPS route for the activity map.
 */
function summarize(activity: Activity): ActivitySummary & {
  sampleCount: number;
  route?: RoutePoint[];
} {
  const { samples, ...summary } = activity;
  const route = routeFromSamples(samples);
  const power = recordedPowerSummary(samples);
  return {
    ...summary,
    sampleCount: samples.length,
    ...(power.averagePower !== null
      ? { averagePower: power.averagePower }
      : {}),
    ...(power.normalizedPower !== null
      ? { normalizedPower: power.normalizedPower }
      : {}),
    ...(route.length >= 2 ? { route } : {}),
  };
}

/** Wraps cached analyses and athlete feedback in the shared response shape. */
function withStoredAnalysis(
  activity: Activity,
  stored: StoredAnalysis,
  program: StoredAnalysis | null,
  feedback?: ActivityFeedback,
): AnalyzedActivity {
  return {
    ...summarize(activity),
    analysis: {
      text: stored.text,
      model: stored.model,
      generatedAt: stored.generatedAt.toISOString(),
    },
    analysisError: null,
    programAnalysis: program ? toCoachAnalysis(program) : null,
    comment: feedback?.comment ?? null,
    coachReply: feedback?.reply ? toCoachAnalysis(feedback.reply) : null,
    reviewed: feedback?.reviewed ?? false,
  };
}

/** An activity shown before an LLM has been configured. */
function withoutAnalysis(
  activity: Activity,
  feedback?: ActivityFeedback,
): AnalyzedActivity {
  return {
    ...summarize(activity),
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: feedback?.comment ?? null,
    coachReply: feedback?.reply ? toCoachAnalysis(feedback.reply) : null,
    reviewed: feedback?.reviewed ?? false,
  };
}
