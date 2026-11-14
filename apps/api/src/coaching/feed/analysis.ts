import {
  activityLocalDate,
  addDays,
  type Activity,
  type AnalyzedActivity,
  type BodyMetricEstimate,
  type CoachAnalysisResult,
  type DailyHealthPoint,
  type MetricPoint,
  type ThresholdSummary,
} from "@killingit/shared";
import { decrypt } from "../../crypto/credentials.js";
import { loadDietContext } from "../../diet/context.js";
import type { DietPromptContext } from "../../diet/summary.js";
import { GARMIN_DAILY_SYNC_WINDOW_DAYS } from "../../garmin/dailySync.js";
import { mapWithConcurrency } from "../../lib/mapWithConcurrency.js";
import {
  ANALYSIS_PROMPT_VERSION,
  type ActivityAnalysisContext,
} from "../../llm/activityPrompt.js";
import { analyzeActivity } from "../../llm/analyze.js";
import {
  loadAnalyses,
  saveAnalysis,
  type StoredAnalysis,
} from "../../llm/analysisStore.js";
import { llmCredentialsKeyFromEnv } from "../../llm/credentials.js";
import { LlmAuthError, type LlmProvider } from "../../llm/openrouter.js";
import type { BodyMetricHistory } from "../../llm/profileContext.js";
import { loadLlmSettings, type StoredLlmSettings } from "../../llm/store.js";
import { loadDailyHealthForUser } from "../../metrics/dailyMetrics.js";
import {
  loadBodyHistoryForUser,
  recordCoachBodyMetrics,
  recordCoachFtp,
} from "../../metrics/store.js";
import {
  loadActivityFeedback,
  type ActivityFeedback,
} from "../../plans/replies.js";
import {
  clearPendingActivityQuestion,
  saveCoachQuestions,
} from "../../plans/coachQuestions.js";
import { dbPlanStore, type StoredPlan } from "../../plans/store.js";
import {
  buildActivityLoads,
  type ActivityLoads,
} from "../../training/activityLoad.js";
import { loadTrainingContext } from "../../training/context.js";
import {
  ftpBaselineAt,
  ftpHistoryPoints,
  type ThresholdTimeline,
} from "../../training/thresholds.js";
import { commentIsNewerThanAnalysis } from "../analysisFreshness.js";
import { LlmCredentialsError } from "./errors.js";
import { failedAnalysis, withStoredAnalysis } from "./presenter.js";

/** Bounded concurrency so a batch does not flood OpenRouter. */
const ANALYSIS_CONCURRENCY = 3;

/** Everything the analysis pass and the final feed need besides the history. */
export interface AnalysisInputs {
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

/** The threshold, load and FTP context for scoring and prompting. */
interface TrainingInputs {
  ftpHistory: MetricPoint[];
  ftp: ThresholdTimeline | null;
  thresholds: ThresholdSummary[];
  loads: ActivityLoads;
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

interface SaveFreshAnalysisParams {
  userId: number;
  activityId: number;
  model: string;
  result: CoachAnalysisResult;
}

/**
 * Loads the per-account context in parallel, then the training context that
 * depends on the stored plan. A training-context failure leaves the activity
 * feed loadable, because load values are supplementary.
 */
export async function loadAnalysisInputs(
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

/**
 * Reuses stored analyses unless the athlete commented after them, analyses the
 * rest concurrently, and stores the FTP and body estimates they returned.
 */
export async function analyzeMissing(
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

/** Loads and decrypts the account's LLM key, reporting a typed error. */
export async function loadLlmApiKey(
  settings: StoredLlmSettings,
): Promise<string> {
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
