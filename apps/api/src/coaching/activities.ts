import type {
  Activity,
  ActivitySummary,
  AnalyzedActivity,
} from "@killingit/shared";
import { decrypt } from "../crypto/credentials.js";
import { syncGarminActivities } from "../garmin/client.js";
import { loadDecryptedGarminCredentials } from "../garmin/credentials.js";
import { mapWithConcurrency } from "../lib/mapWithConcurrency.js";
import { ANALYSIS_PROMPT_VERSION } from "../llm/activityPrompt.js";
import { analyzeActivity } from "../llm/analyze.js";
import {
  loadAnalyses,
  saveAnalysis,
  type StoredAnalysis,
} from "../llm/analysisStore.js";
import { llmCredentialsKeyFromEnv } from "../llm/credentials.js";
import {
  createOpenRouterProvider,
  LlmAuthError,
  LlmProviderError,
  type LlmProvider,
} from "../llm/openrouter.js";
import { loadLlmSettings } from "../llm/store.js";

/** How many of the latest synced activities can be returned in one feed. */
export const MAX_ACTIVITIES = 20;
export const DEFAULT_ACTIVITIES = 10;
/** Bounded concurrency so a batch does not flood OpenRouter. */
const ANALYSIS_CONCURRENCY = 3;

/** The operator has not connected Garmin yet. */
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
  limit: number;
  refresh: boolean;
  provider?: LlmProvider;
}): Promise<ActivityFeed> {
  const provider = options.provider ?? createOpenRouterProvider();

  let garminCredentials;
  try {
    garminCredentials = await loadDecryptedGarminCredentials();
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
  const latest = [...activities]
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))
    .slice(0, options.limit);

  const settings = await loadLlmSettings();
  if (!settings) {
    return {
      model: null,
      activities: latest.map(withoutAnalysis),
    };
  }

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

  const cached = options.refresh
    ? new Map<number, StoredAnalysis>()
    : await loadAnalyses(
        latest.map((activity) => activity.id),
        settings.model,
        ANALYSIS_PROMPT_VERSION,
      );

  const analysed = await mapWithConcurrency(
    latest,
    ANALYSIS_CONCURRENCY,
    async (activity): Promise<AnalyzedActivity> => {
      const hit = cached.get(activity.id);
      if (hit) {
        return withStoredAnalysis(activity, hit);
      }

      try {
        const text = await analyzeActivity(
          provider,
          { apiKey, model: settings.model },
          activity,
        );
        const saved = await saveAnalysis({
          activityId: activity.id,
          model: settings.model,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          text,
        });
        return withStoredAnalysis(activity, saved);
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
        };
      }
    },
  );

  return { model: settings.model, activities: analysed };
}

/** Strips the (large) timeseries, keeping the summary and its sample count. */
function summarize(activity: Activity): ActivitySummary & {
  sampleCount: number;
} {
  const { samples, ...summary } = activity;
  return { ...summary, sampleCount: samples.length };
}

/** Wraps a cached analysis in the shared activity response shape. */
function withStoredAnalysis(
  activity: Activity,
  stored: StoredAnalysis,
): AnalyzedActivity {
  return {
    ...summarize(activity),
    analysis: {
      text: stored.text,
      model: stored.model,
      generatedAt: stored.generatedAt.toISOString(),
    },
    analysisError: null,
  };
}

/** An activity shown before an LLM has been configured. */
function withoutAnalysis(activity: Activity): AnalyzedActivity {
  return { ...summarize(activity), analysis: null, analysisError: null };
}
