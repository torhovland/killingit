import {
  activityLocalDate,
  recordedPowerSummary,
  zonedDateTime,
  type Activity,
  type ActivitySample,
  type ActivitySummary,
  type AnalyzedActivity,
  type BodyMetricEstimate,
  type CoachAnalysisResult,
  type CoachPlan,
  type DailyHealthPoint,
  type MetricPoint,
  type RoutePoint,
  type ThresholdSummary,
} from "@killingit/shared";
import { decrypt } from "../crypto/credentials.js";
import { loadDietContext } from "../diet/context.js";
import type { DietPromptContext } from "../diet/summary.js";
import {
  syncGarminActivities,
  syncGarminMetrics,
  type GarminCredentials,
} from "../garmin/client.js";
import {
  GARMIN_DAILY_SYNC_WINDOW_DAYS,
  syncGarminDailyHistory,
} from "../garmin/dailySync.js";
import { commentIsNewerThanAnalysis } from "./analysisFreshness.js";
import { loadDeletedActivityIds } from "./deletions.js";
import { loadDecryptedGarminCredentials } from "../garmin/credentials.js";
import {
  loadBodyHistoryForUser,
  recordCoachBodyMetrics,
  recordCoachFtp,
  recordGarminBodyMetrics,
  recordGarminFtp,
} from "../metrics/store.js";
import { loadDailyHealthForUser } from "../metrics/dailyMetrics.js";
import { downsample } from "../lib/downsample.js";
import { mapWithConcurrency } from "../lib/mapWithConcurrency.js";
import { addDays } from "@killingit/shared";
import {
  ANALYSIS_PROMPT_VERSION,
  type ActivityAnalysisContext,
} from "../llm/activityPrompt.js";
import { analyzeActivity } from "../llm/analyze.js";
import {
  loadAnalyses,
  saveAnalysis,
  type StoredAnalysis,
} from "../llm/analysisStore.js";
import {
  loadActivityFeedback,
  toCoachAnalysis,
  type ActivityFeedback,
} from "../plans/replies.js";
import type { BodyMetricHistory } from "../llm/profileContext.js";
import {
  clearPendingActivityQuestion,
  saveCoachQuestions,
} from "../plans/coachQuestions.js";
import { llmCredentialsKeyFromEnv } from "../llm/credentials.js";
import { withPromptLogging } from "../llm/callLog.js";
import {
  createOpenRouterProvider,
  LlmAuthError,
  LlmProviderError,
  type LlmProvider,
} from "../llm/openrouter.js";
import { assertModelUsable } from "../llm/client.js";
import { loadLlmSettings, type StoredLlmSettings } from "../llm/store.js";
import { dbPlanStore, type StoredPlan } from "../plans/store.js";
import {
  buildActivityLoads,
  type ActivityLoads,
} from "../training/activityLoad.js";
import { loadTrainingContext } from "../training/context.js";
import {
  ftpBaselineAt,
  ftpHistoryPoints,
  type ThresholdTimeline,
} from "../training/thresholds.js";
import { loadCachedActivityFeed, saveCachedActivityFeed } from "./feedCache.js";
import { shareActivityAnalysis } from "./analysisRuns.js";
import { routeFromSamples } from "./route.js";

/** Enough samples for a readable preview without bloating the cached feed. */
export const MAX_PREVIEW_SAMPLES = 120;
/** Bounded concurrency so a batch does not flood OpenRouter. */
const ANALYSIS_CONCURRENCY = 3;

export { commentIsNewerThanAnalysis };

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

interface AnalyzeActivitiesOptions {
  userId: number;
  limit: number;
  refresh: boolean;
  /** The athlete's local date; defaults to today in their time zone. */
  today?: string;
  /**
   * The athlete's IANA time zone, so an activity is dated by its local day.
   * A missing zone reads as UTC; see `docs/specs/activity-local-date.md`.
   */
  timezone?: string;
  provider?: LlmProvider;
}

/** The phase implementations behind one feed load, injectable for tests. */
interface ActivityFeedPhases {
  loadGarminCredentials: typeof loadGarminCredentials;
  syncFeed: typeof syncFeed;
  loadAnalysisInputs: typeof loadAnalysisInputs;
  analyzeMissing: typeof analyzeMissing;
  assembleFeed: typeof assembleFeed;
  assertModelUsable: typeof assertModelUsable;
  loadLlmApiKey: typeof loadLlmApiKey;
}

const ACTIVITY_FEED_PHASES: ActivityFeedPhases = {
  loadGarminCredentials,
  syncFeed,
  loadAnalysisInputs,
  analyzeMissing,
  assembleFeed,
  assertModelUsable,
  loadLlmApiKey,
};

/**
 * Syncs the latest Garmin activities and returns them with cached-or-fresh
 * coach analyses. Before an LLM is configured, activities are returned without
 * analyses so the Garmin sync remains useful.
 *
 * Overlapping callers share one pass, so a plan run that starts while the
 * dashboard is analysing activities waits for that pass and plans from the
 * finished feed instead of an older analysis it would have to revise again.
 */
export function loadAnalyzedActivities(
  options: AnalyzeActivitiesOptions,
  phases: ActivityFeedPhases = ACTIVITY_FEED_PHASES,
): Promise<ActivityFeed> {
  return shareActivityAnalysis(options.userId, options.refresh, () =>
    loadAnalyzedActivitiesOnce(options, phases),
  );
}

async function loadAnalyzedActivitiesOnce(
  options: AnalyzeActivitiesOptions,
  phases: ActivityFeedPhases,
): Promise<ActivityFeed> {
  const provider =
    options.provider ??
    withPromptLogging(createOpenRouterProvider(), { userId: options.userId });
  const credentials = await phases.loadGarminCredentials(options.userId);
  const today =
    options.today ?? zonedDateTime(new Date(), options.timezone).date;

  const synced = await phases.syncFeed({
    userId: options.userId,
    credentials,
    today,
    limit: options.limit,
  });
  const inputs = await phases.loadAnalysisInputs(
    options.userId,
    synced.history,
    today,
    options.timezone,
  );
  if (inputs.settings === null) {
    return phases.assembleFeed({
      userId: options.userId,
      history: synced.history,
      inputs,
      model: null,
      analyses: [],
      timezone: options.timezone,
    });
  }

  const model = inputs.settings.dailyModel ?? inputs.settings.model;
  await phases.assertModelUsable(model, "daily");
  const apiKey = await phases.loadLlmApiKey(inputs.settings);
  const outcomes = await phases.analyzeMissing({
    userId: options.userId,
    provider,
    apiKey,
    model,
    latest: synced.latest,
    refresh: options.refresh,
    inputs,
    today,
    timezone: options.timezone,
  });
  return phases.assembleFeed({
    userId: options.userId,
    history: synced.history,
    inputs,
    model,
    analyses: outcomes.map((outcome) => outcome.activity),
    timezone: options.timezone,
  });
}

/** The stored credentials, or a typed error the route can report. */
async function loadGarminCredentials(
  userId: number,
): Promise<GarminCredentials> {
  let credentials;
  try {
    credentials = await loadDecryptedGarminCredentials(userId);
  } catch (err) {
    throw new GarminCredentialsError(
      "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
      { cause: err },
    );
  }
  if (credentials === null) {
    throw new GarminNotConnectedError();
  }
  return credentials;
}

/** Loads and decrypts the account's LLM key, reporting a typed error. */
async function loadLlmApiKey(settings: StoredLlmSettings): Promise<string> {
  try {
    const key = await llmCredentialsKeyFromEnv();
    return await decrypt(settings.apiKeyEncrypted, key);
  } catch (err) {
    throw new LlmCredentialsError(
      "OpenRouter credentials are unavailable (check LLM_CREDENTIALS_KEY)",
      { cause: err },
    );
  }
}

/** The newest activities to analyse and every activity ever synced. */
interface SyncedFeed {
  /** The synced activities within the analysis limit, newest first. */
  latest: readonly Activity[];
  /** Every synced activity merged with stored history, newest first. */
  history: AnalyzedActivity[];
}

/**
 * Syncs Garmin activities, body metrics and daily health, merges the result
 * with the stored history, and stores the full history before the (potentially
 * slow) LLM analyses so a reload during analysis still shows every activity.
 */
async function syncFeed(params: {
  userId: number;
  credentials: GarminCredentials;
  today: string;
  limit: number;
}): Promise<SyncedFeed> {
  const activities = await syncGarminActivities(params.credentials);
  await syncBodyMetrics(params.userId, params.credentials);
  await syncDailyHealth(params.userId, params.credentials, params.today);
  const deletedIds = await loadDeletedActivityIds(params.userId, "garmin");
  const synced = [...activities]
    .filter((activity) => !deletedIds.has(String(activity.id)))
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
  const previous = await loadPreviousActivities(params.userId);
  const history = mergeActivityHistory(previous, synced, deletedIds);
  await persistFeed(params.userId, { model: null, activities: history });
  return { latest: synced.slice(0, params.limit), history };
}

/** Everything the analysis pass and the final feed need besides the history. */
interface AnalysisInputs {
  settings: StoredLlmSettings | null;
  feedback: ReadonlyMap<string, ActivityFeedback>;
  storedPlan: StoredPlan | null;
  dailyHealth: DailyHealthPoint[] | undefined;
  bodyHistory: BodyMetricHistory | undefined;
  diet: DietPromptContext | null;
  ftpHistory: MetricPoint[];
  ftp: ThresholdTimeline | null;
  thresholds: ThresholdSummary[];
  loads: ActivityLoads;
}

/**
 * Loads the per-account context in parallel, then the training context that
 * depends on the stored plan. A training-context failure leaves the activity
 * feed loadable, because load values are supplementary.
 */
async function loadAnalysisInputs(
  userId: number,
  history: readonly AnalyzedActivity[],
  today: string,
  timezone: string | undefined,
): Promise<AnalysisInputs> {
  const [settings, feedback, storedPlan, dailyHealth, bodyHistory, diet] =
    await Promise.all([
      loadLlmSettings(userId),
      loadActivityFeedback(
        userId,
        history.map((activity) => activity.id),
      ),
      dbPlanStore.load(userId),
      loadDailyHealthSafely(userId, today),
      loadBodyHistorySafely(userId),
      loadDietContext(userId, today),
    ]);
  const training = await loadTrainingInputs(
    userId,
    history,
    storedPlan,
    timezone,
  );
  return {
    settings,
    feedback,
    storedPlan,
    dailyHealth,
    bodyHistory,
    diet,
    ...training,
  };
}

/** The threshold, load and FTP context for scoring and prompting. */
interface TrainingInputs {
  ftpHistory: MetricPoint[];
  ftp: ThresholdTimeline | null;
  thresholds: ThresholdSummary[];
  loads: ActivityLoads;
}

async function loadTrainingInputs(
  userId: number,
  history: readonly AnalyzedActivity[],
  storedPlan: StoredPlan | null,
  timezone: string | undefined,
): Promise<TrainingInputs> {
  try {
    const training = await loadTrainingContext(
      userId,
      storedPlan?.plan,
      timezone,
    );
    const tssByDate = new Map(training.planTssByDate);
    for (const [date, tss] of training.manualTssByDate) {
      tssByDate.set(date, tss);
    }
    return {
      ftpHistory: ftpHistoryPoints(training.thresholdTimelines),
      ftp: training.ftpTimeline,
      thresholds: training.thresholds,
      loads: buildActivityLoads(
        history,
        training.thresholdTimelines,
        timezone,
        tssByDate,
      ),
    };
  } catch (err) {
    console.error("[training-load] could not score activities:", err);
    return {
      ftpHistory: [],
      ftp: null,
      thresholds: [],
      loads: { byDate: new Map(), byActivityId: new Map() },
    };
  }
}

/** Builds the prompt context from the stored plan and the loaded history. */
function analysisContextFor(
  inputs: AnalysisInputs,
  today: string,
  timezone: string | undefined,
): ActivityAnalysisContext {
  const plan = inputs.storedPlan?.plan;
  return {
    today: plan?.today.date ?? today,
    ...(timezone !== undefined ? { timezone } : {}),
    ...(plan !== undefined
      ? { season: plan.season, block: plan.block, week: plan.week }
      : {}),
    ftpHistory: inputs.ftpHistory,
    thresholds: inputs.thresholds,
    ...(inputs.dailyHealth !== undefined
      ? { dailyHealth: inputs.dailyHealth }
      : {}),
    ...(inputs.bodyHistory !== undefined
      ? { bodyHistory: inputs.bodyHistory }
      : {}),
    ...(inputs.diet !== null ? { diet: inputs.diet } : {}),
  };
}

/** One activity's updated feed entry plus any estimate the coach returned. */
interface ActivityAnalysisOutcome {
  activity: AnalyzedActivity;
  ftpEstimate?: { date: string; watts: number };
  bodyMetric?: BodyMetricEstimate;
}

interface AnalyzeMissingParams {
  userId: number;
  provider: LlmProvider;
  apiKey: string;
  model: string;
  latest: readonly Activity[];
  refresh: boolean;
  inputs: AnalysisInputs;
  today: string;
  timezone: string | undefined;
}

/**
 * Reuses stored analyses unless the athlete commented after them, analyses the
 * rest concurrently, and stores the FTP and body estimates they returned.
 */
async function analyzeMissing(
  params: AnalyzeMissingParams,
): Promise<ActivityAnalysisOutcome[]> {
  const [cached, cachedProgram] = await loadAnalysisCache(
    params.userId,
    params.latest,
    params.refresh,
  );
  const context = analysisContextFor(
    params.inputs,
    params.today,
    params.timezone,
  );
  const outcomes = await mapWithConcurrency(
    params.latest,
    ANALYSIS_CONCURRENCY,
    (activity) =>
      analyzeOne({
        userId: params.userId,
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        activity,
        feedback: params.inputs.feedback.get(String(activity.id)),
        context,
        ftp: params.inputs.ftp,
        cached,
        cachedProgram,
      }),
  );
  await recordActivityEstimates(params.userId, outcomes);
  return outcomes;
}

/** Loads both analysis kinds, or nothing when the caller asked to refresh. */
async function loadAnalysisCache(
  userId: number,
  activities: readonly Activity[],
  refresh: boolean,
): Promise<[Map<number, StoredAnalysis>, Map<number, StoredAnalysis>]> {
  if (refresh) {
    return [new Map(), new Map()];
  }
  const activityIds = activities.map((activity) => activity.id);
  return Promise.all([
    loadAnalyses(userId, activityIds),
    loadAnalyses(userId, activityIds, "program"),
  ]);
}

interface AnalyzeOneParams {
  userId: number;
  provider: LlmProvider;
  apiKey: string;
  model: string;
  activity: Activity;
  feedback: ActivityFeedback | undefined;
  context: ActivityAnalysisContext;
  ftp: ThresholdTimeline | null;
  cached: ReadonlyMap<number, StoredAnalysis>;
  cachedProgram: ReadonlyMap<number, StoredAnalysis>;
}

/** Returns a stored or fresh analysis for one activity, never failing the feed. */
async function analyzeOne(
  params: AnalyzeOneParams,
): Promise<ActivityAnalysisOutcome> {
  const { activity, feedback } = params;
  const cachedAnalysis = params.cached.get(activity.id);
  const program = params.cachedProgram.get(activity.id) ?? null;
  // A comment saved after the analysis carries information the last analysis
  // could not see, so regenerate instead of reusing it.
  if (
    cachedAnalysis !== undefined &&
    !commentIsNewerThanAnalysis(cachedAnalysis, feedback?.commentUpdatedAt)
  ) {
    return {
      activity: withStoredAnalysis(activity, cachedAnalysis, program, feedback),
    };
  }

  const activityDate = activityLocalDate(activity, params.context.timezone);
  try {
    const result = await analyzeActivity(
      params.provider,
      { apiKey: params.apiKey, model: params.model },
      activity,
      {
        ...params.context,
        currentFtpWatts: currentFtpAt(params.ftp, activityDate),
      },
      feedback?.comment ?? null,
    );
    const saved = await saveFreshAnalysis({
      userId: params.userId,
      activityId: activity.id,
      model: params.model,
      result,
    });
    return {
      activity: withStoredAnalysis(activity, saved, program, feedback),
      ...(result.estimatedFtpWatts !== null
        ? {
            ftpEstimate: {
              date: activityDate,
              watts: result.estimatedFtpWatts,
            },
          }
        : {}),
      ...(result.weightKg !== null || result.bodyFatPercent !== null
        ? {
            bodyMetric: {
              date: activityDate,
              weightKg: result.weightKg,
              bodyFatPercent: result.bodyFatPercent,
            },
          }
        : {}),
    };
  } catch (err) {
    // A revoked/invalid key affects every activity; surface it instead of
    // returning a list where every card says "analysis failed".
    if (err instanceof LlmAuthError) {
      throw err;
    }
    return { activity: failedAnalysis(activity, err, program, feedback) };
  }
}

/** The FTP in effect on an activity date, when a timeline is known. */
function currentFtpAt(
  ftp: ThresholdTimeline | null,
  date: string,
): number | null {
  return ftp === null ? null : (ftpBaselineAt(ftp, date)?.watts ?? null);
}

interface SaveFreshAnalysisParams {
  userId: number;
  activityId: number;
  model: string;
  result: CoachAnalysisResult;
}

/**
 * Stores a regenerated analysis and replaces the question the previous one
 * asked about this activity, keeping the new result's question if it has one.
 */
async function saveFreshAnalysis(
  params: SaveFreshAnalysisParams,
): Promise<StoredAnalysis> {
  const { result } = params;
  const saved = await saveAnalysis({
    userId: params.userId,
    activityId: params.activityId,
    model: params.model,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    text: result.analysis,
    planChangeNeeded: result.planChangeNeeded,
  });
  try {
    await clearPendingActivityQuestion(
      params.userId,
      String(params.activityId),
    );
  } catch (err) {
    console.error("[coaching] could not clear stale coach questions:", err);
  }
  if (result.coachQuestion !== undefined && result.coachQuestion !== null) {
    try {
      await saveCoachQuestions({
        userId: params.userId,
        questions: [result.coachQuestion],
        target: String(params.activityId),
        model: params.model,
        sourceKind: "activity_analysis",
      });
    } catch (err) {
      console.error("[coaching] could not store coach questions:", err);
    }
  }
  return saved;
}

/** Shows a failed analysis on the card without losing stored feedback. */
function failedAnalysis(
  activity: Activity,
  err: unknown,
  program: StoredAnalysis | null,
  feedback: ActivityFeedback | undefined,
): AnalyzedActivity {
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
    comment: feedback?.comment ?? null,
    coachReply: feedback?.reply ? toCoachAnalysis(feedback.reply) : null,
    reviewed: feedback?.reviewed ?? false,
  };
}

/** Stores the coach's FTP and body estimates, oldest first. */
async function recordActivityEstimates(
  userId: number,
  outcomes: readonly ActivityAnalysisOutcome[],
): Promise<void> {
  // Apply estimates oldest first so a newer activity cannot be removed by an
  // older one that happened to finish its LLM call later.
  const ftpEstimates = outcomes
    .flatMap((outcome) => (outcome.ftpEstimate ? [outcome.ftpEstimate] : []))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const estimate of ftpEstimates) {
    try {
      await recordCoachFtp({ userId, ...estimate });
    } catch (err) {
      console.error("[metrics] could not store an activity FTP estimate:", err);
    }
  }

  const bodyMetrics = outcomes.flatMap((outcome) =>
    outcome.bodyMetric ? [outcome.bodyMetric] : [],
  );
  if (bodyMetrics.length === 0) {
    return;
  }
  try {
    await recordCoachBodyMetrics(
      userId,
      bodyMetrics.sort((a, b) => a.date.localeCompare(b.date)),
    );
  } catch (err) {
    console.error("[metrics] could not store activity body metrics:", err);
  }
}

interface AssembleFeedParams {
  userId: number;
  history: readonly AnalyzedActivity[];
  inputs: AnalysisInputs;
  model: string | null;
  analyses: readonly AnalyzedActivity[];
  timezone: string | undefined;
}

/** Combines the analysed activities with the history and stores the feed. */
async function assembleFeed(params: AssembleFeedParams): Promise<ActivityFeed> {
  const analyzedById = new Map(
    params.analyses.map((activity) => [String(activity.id), activity]),
  );
  const feed: ActivityFeed = {
    model: params.model,
    activities: params.history.map((activity) => {
      const analyzed = analyzedById.get(String(activity.id));
      return withActivityLoad(
        analyzed ?? withFeedback(activity, params.inputs.feedback),
        params.inputs.loads,
        params.timezone,
      );
    }),
  };
  await persistFeed(params.userId, feed);
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
  timezone?: string | null,
): Promise<ActivityLoads> {
  const { thresholdTimelines, planTssByDate, manualTssByDate } =
    await loadTrainingContext(userId, plan, timezone);
  const tssByDate = new Map(planTssByDate);
  for (const [date, tss] of manualTssByDate) {
    tssByDate.set(date, tss);
  }
  return buildActivityLoads(
    activities,
    thresholdTimelines,
    timezone,
    tssByDate,
  );
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

/**
 * Pulls daily health and recovery metrics after the activities. The pass is
 * fail-open: its own function already stops on a rate limit, and a failure here
 * must not hide the synced activities.
 */
async function syncDailyHealth(
  userId: number,
  credentials: { username: string; password: string },
  today: string,
): Promise<void> {
  try {
    await syncGarminDailyHistory({ userId, credentials, today });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[garmin] could not sync daily health metrics: ${detail}`);
  }
}

/** Loads the daily health series for prompts, omitting it on a read failure. */
async function loadDailyHealthSafely(
  userId: number,
  today: string,
): Promise<DailyHealthPoint[] | undefined> {
  try {
    return await loadDailyHealthForUser(
      userId,
      addDays(today, -GARMIN_DAILY_SYNC_WINDOW_DAYS),
      today,
    );
  } catch (err) {
    console.error("[garmin] could not read daily health metrics:", err);
    return undefined;
  }
}

/** Loads body weight/body-fat history for prompts, omitting it on a failure. */
async function loadBodyHistorySafely(userId: number) {
  try {
    return await loadBodyHistoryForUser(userId);
  } catch (err) {
    console.error("[garmin] could not read body metrics:", err);
    return undefined;
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
  timezone: string | undefined,
): AnalyzedActivity {
  return {
    ...activity,
    activityTss:
      loads.byActivityId.get(activity.id) ?? activity.activityTss ?? null,
    trainingLoad:
      loads.byDate.get(activityLocalDate(activity, timezone)) ?? null,
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
      planChangeNeeded: stored.planChangeNeeded,
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
