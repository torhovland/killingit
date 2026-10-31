import {
  recordedPowerSummary,
  type Activity,
  type ActivitySample,
  type ActivitySummary,
  type AnalyzedActivity,
  type BodyMetricEstimate,
  type CoachPlan,
  type MetricPoint,
  type RoutePoint,
  type ThresholdSummary,
} from "@killingit/shared";
import { decrypt } from "../crypto/credentials.js";
import { syncGarminActivities, syncGarminMetrics } from "../garmin/client.js";
import { loadDeletedActivityIds } from "./deletions.js";
import { loadDecryptedGarminCredentials } from "../garmin/credentials.js";
import {
  recordCoachBodyMetrics,
  recordCoachFtp,
  recordGarminBodyMetrics,
  recordGarminFtp,
} from "../metrics/store.js";
import { downsample } from "../lib/downsample.js";
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
import { saveCoachQuestions } from "../plans/coachQuestions.js";
import { llmCredentialsKeyFromEnv } from "../llm/credentials.js";
import { withPromptLogging } from "../llm/callLog.js";
import {
  createOpenRouterProvider,
  LlmAuthError,
  LlmProviderError,
  type LlmProvider,
} from "../llm/openrouter.js";
import { assertModelUsable } from "../llm/client.js";
import { loadLlmSettings } from "../llm/store.js";
import { dbPlanStore } from "../plans/store.js";
import {
  buildActivityLoads,
  type ActivityLoads,
} from "../training/activityLoad.js";
import { loadTrainingContext } from "../training/context.js";
import { ftpBaselineAt, type FtpTimeline } from "../training/ftp.js";
import { loadCachedActivityFeed, saveCachedActivityFeed } from "./feedCache.js";
import { routeFromSamples } from "./route.js";

/** Enough samples for a readable preview without bloating the cached feed. */
export const MAX_PREVIEW_SAMPLES = 120;
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
  const provider =
    options.provider ??
    withPromptLogging(createOpenRouterProvider(), { userId: options.userId });

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
  await syncBodyMetrics(options.userId, garminCredentials);
  const deletedIds = await loadDeletedActivityIds(options.userId, "garmin");
  const synced = [...activities]
    .filter((activity) => !deletedIds.has(String(activity.id)))
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
  const latest = synced.slice(0, options.limit);
  const previous = await loadPreviousActivities(options.userId);
  const history = mergeActivityHistory(previous, synced, deletedIds);

  // Store the full history before the (potentially slow) LLM analyses so a
  // reload during analysis still shows every activity that was ever synced.
  await persistFeed(options.userId, { model: null, activities: history });

  const [settings, feedback, storedPlan] = await Promise.all([
    loadLlmSettings(options.userId),
    loadActivityFeedback(
      options.userId,
      history.map((activity) => activity.id),
    ),
    dbPlanStore.load(options.userId),
  ]);
  let loads: ActivityLoads = {
    byDate: new Map(),
    byActivityId: new Map(),
  };
  let ftpHistory: MetricPoint[] = [];
  let ftpTimeline: FtpTimeline | null = null;
  let trainingThresholds: ThresholdSummary[] = [];
  try {
    const training = await loadTrainingContext(
      options.userId,
      storedPlan?.plan,
    );
    const promptThroughDate =
      storedPlan?.plan.today.date ?? new Date().toISOString().slice(0, 10);
    ftpHistory = training.ftpHistory.filter(
      (point) => point.date <= promptThroughDate,
    );
    ftpTimeline = training.timeline;
    trainingThresholds = training.thresholds;
    const tssByDate = new Map(training.planTssByDate);
    for (const [date, tss] of training.manualTssByDate) {
      tssByDate.set(date, tss);
    }
    loads = buildActivityLoads(history, training.thresholdTimelines, tssByDate);
  } catch (err) {
    // Load values are supplementary; the activity feed must still load.
    console.error("[training-load] could not score activities:", err);
  }
  if (!settings) {
    const feed: ActivityFeed = {
      model: null,
      activities: history.map((activity) =>
        withActivityLoad(withFeedback(activity, feedback), loads),
      ),
    };
    await persistFeed(options.userId, feed);
    return feed;
  }

  const dailyModel = settings.dailyModel ?? settings.model;
  await assertModelUsable(dailyModel, "daily");

  const analysisContext = storedPlan
    ? {
        today: storedPlan.plan.today.date,
        week: storedPlan.plan.week,
        ftpHistory,
        thresholds: trainingThresholds,
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
          dailyModel,
          ANALYSIS_PROMPT_VERSION,
        ),
        loadAnalyses(
          options.userId,
          activityIds,
          dailyModel,
          PROGRAM_ANALYSIS_PROMPT_VERSION,
          "program",
        ),
      ]);

  const ftpEstimates: { date: string; watts: number }[] = [];
  const bodyMetrics: BodyMetricEstimate[] = [];
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
        const activityDate = activity.startDate.slice(0, 10);
        const currentFtpWatts =
          ftpTimeline === null
            ? null
            : (ftpBaselineAt(ftpTimeline, activityDate)?.watts ?? null);
        const result = await analyzeActivity(
          provider,
          { apiKey, model: dailyModel },
          activity,
          analysisContext === undefined
            ? undefined
            : { ...analysisContext, currentFtpWatts },
        );
        const saved = await saveAnalysis({
          userId: options.userId,
          activityId: activity.id,
          model: dailyModel,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          text: result.analysis,
        });
        if (
          result.coachQuestions !== undefined &&
          result.coachQuestions !== null &&
          result.coachQuestions.length > 0
        ) {
          try {
            await saveCoachQuestions({
              userId: options.userId,
              questions: result.coachQuestions,
              model: dailyModel,
              sourceKind: "activity_analysis",
            });
          } catch (err) {
            console.error("[coaching] could not store coach questions:", err);
          }
        }
        if (result.estimatedFtpWatts !== null) {
          ftpEstimates.push({
            date: activityDate,
            watts: result.estimatedFtpWatts,
          });
        }
        if (result.weightKg !== null || result.bodyFatPercent !== null) {
          bodyMetrics.push({
            date: activityDate,
            weightKg: result.weightKg,
            bodyFatPercent: result.bodyFatPercent,
          });
        }
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

  // Apply estimates oldest first so a newer activity cannot be removed by an
  // older one that happened to finish its LLM call later.
  for (const estimate of ftpEstimates.sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    try {
      await recordCoachFtp({ userId: options.userId, ...estimate });
    } catch (err) {
      console.error("[metrics] could not store an activity FTP estimate:", err);
    }
  }

  if (bodyMetrics.length > 0) {
    try {
      await recordCoachBodyMetrics(
        options.userId,
        bodyMetrics.sort((a, b) => a.date.localeCompare(b.date)),
      );
    } catch (err) {
      console.error("[metrics] could not store activity body metrics:", err);
    }
  }

  const analyzedById = new Map(
    analysed.map((activity) => [String(activity.id), activity]),
  );
  const feed: ActivityFeed = {
    model: dailyModel,
    activities: history.map((activity) => {
      const analyzed = analyzedById.get(String(activity.id));
      return withActivityLoad(
        analyzed ?? withFeedback(activity, feedback),
        loads,
      );
    }),
  };
  await persistFeed(options.userId, feed);
  return feed;
}

/**
 * Combines a fresh Garmin sync with the activities already stored for the
 * athlete. New activities are added, synced ones get their latest summary and
 * preview, and activities that have fallen outside Garmin's sync window keep
 * their stored analysis and feedback. Locally deleted activities are omitted.
 * Everything is returned newest first.
 */
export function mergeActivityHistory(
  previous: readonly AnalyzedActivity[],
  synced: readonly Activity[],
  deletedIds: ReadonlySet<string> = new Set(),
): AnalyzedActivity[] {
  const byId = new Map(
    previous
      .filter((activity) => !deletedIds.has(String(activity.id)))
      .map((activity) => [String(activity.id), activity]),
  );
  for (const activity of synced) {
    if (deletedIds.has(String(activity.id))) {
      continue;
    }
    const existing = byId.get(String(activity.id));
    byId.set(
      String(activity.id),
      existing === undefined
        ? withoutAnalysis(activity)
        : refreshSyncedActivity(existing, activity),
    );
  }
  return [...byId.values()].sort(
    (a, b) => Date.parse(b.startDate) - Date.parse(a.startDate),
  );
}

/**
 * Builds the training-load snapshots for the synced activity dates and the TSS
 * each activity contributes on its own. The FTP timeline includes any revised
 * test result the athlete mentioned, and the stored plan supplies coach TSS
 * estimates for the days it covers.
 */
export async function loadUserActivityTrainingLoads(
  userId: number,
  activities: readonly AnalyzedActivity[],
  plan: CoachPlan | undefined,
): Promise<ActivityLoads> {
  const { thresholdTimelines, planTssByDate, manualTssByDate } =
    await loadTrainingContext(userId, plan);
  const tssByDate = new Map(planTssByDate);
  for (const [date, tss] of manualTssByDate) {
    tssByDate.set(date, tss);
  }
  return buildActivityLoads(activities, thresholdTimelines, tssByDate);
}

/**
 * Pulls Garmin body-composition weigh-ins into the metric time series. A
 * failure here must not fail the activity feed: body data is supplementary.
 */
async function syncBodyMetrics(
  userId: number,
  credentials: { username: string; password: string },
): Promise<void> {
  try {
    const snapshot = await syncGarminMetrics(credentials);
    await recordGarminBodyMetrics(userId, snapshot.metrics);
    await recordGarminFtp(userId, snapshot.ftp);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[garmin] could not sync body metrics: ${detail}`);
  }
}

/** Reads the stored feed so a sync extends it instead of dropping older work. */
async function loadPreviousActivities(
  userId: number,
): Promise<readonly AnalyzedActivity[]> {
  try {
    return (await loadCachedActivityFeed(userId))?.activities ?? [];
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[coaching] could not read the stored activity feed: ${detail}`,
    );
    return [];
  }
}

/**
 * Updates a stored activity's summary from a fresh sync while keeping the
 * coach analysis and athlete feedback already attached to it.
 */
function refreshSyncedActivity(
  previous: AnalyzedActivity,
  activity: Activity,
): AnalyzedActivity {
  return {
    ...summarize(activity),
    analysis: previous.analysis,
    analysisError: previous.analysisError,
    programAnalysis: previous.programAnalysis,
    comment: previous.comment,
    coachReply: previous.coachReply,
    reviewed: previous.reviewed,
  };
}

/** Applies the latest stored athlete feedback to an activity in the history. */
function withFeedback(
  activity: AnalyzedActivity,
  feedback: ReadonlyMap<string, ActivityFeedback>,
): AnalyzedActivity {
  const entry = feedback.get(String(activity.id));
  if (entry === undefined) {
    return activity;
  }
  return {
    ...activity,
    comment: entry.comment,
    coachReply: entry.reply ? toCoachAnalysis(entry.reply) : null,
    reviewed: entry.reviewed,
  };
}

/** Attaches the day's fitness snapshot and the activity's own TSS for the page. */
function withActivityLoad(
  activity: AnalyzedActivity,
  loads: ActivityLoads,
): AnalyzedActivity {
  return {
    ...activity,
    activityTss:
      loads.byActivityId.get(activity.id) ?? activity.activityTss ?? null,
    trainingLoad: loads.byDate.get(activity.startDate.slice(0, 10)) ?? null,
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
 * Strips the (large) timeseries, keeping the summary, its sample count, a
 * bounded sample preview for the activities page, and a bounded GPS route for
 * the activity map.
 */
function summarize(activity: Activity): ActivitySummary & {
  sampleCount: number;
  samples: ActivitySample[];
  route?: RoutePoint[];
} {
  const { samples, ...summary } = activity;
  const route = routeFromSamples(samples);
  const power = recordedPowerSummary(samples);
  return {
    ...summary,
    sampleCount: samples.length,
    samples: downsample(samples, MAX_PREVIEW_SAMPLES),
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
