import {
  analyzedActivitiesResponseSchema,
  type Activity,
  type ActivitySummary,
  type AnalyzedActivity,
} from "@killingit/shared";
import { Hono } from "hono";
import { z } from "zod";
import { decrypt } from "../crypto/credentials.js";
import {
  GarminAuthError,
  GarminSidecarError,
  syncGarminActivities,
} from "../garmin/client.js";
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
} from "../llm/openrouter.js";
import { loadLlmSettings } from "../llm/store.js";

/** How many of the latest synced activities are analysed and returned. */
const MAX_ACTIVITIES = 20;
const DEFAULT_ACTIVITIES = 10;
/** Bounded concurrency so a batch does not flood OpenRouter. */
const ANALYSIS_CONCURRENCY = 3;

const querySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ACTIVITIES)
    .default(DEFAULT_ACTIVITIES),
  refresh: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

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

/**
 * Coaching routes (ADR 0004). Syncs the operator's Garmin activities, analyses
 * the most recent ones with the configured LLM, and returns activity data plus
 * cached-or-fresh coach analysis. One failed analysis does not fail the batch.
 */
export const coachingRoute = new Hono().get("/activities", async (c) => {
  const query = querySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.text("Invalid query parameters", 400);
  }

  let garminCredentials;
  try {
    garminCredentials = await loadDecryptedGarminCredentials();
  } catch (err) {
    console.error("[coaching] could not read Garmin credentials:", err);
    return c.text(
      "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
      503,
    );
  }
  if (!garminCredentials) {
    return c.text("Not connected to Garmin", 401);
  }

  let activities: Activity[];
  try {
    activities = await syncGarminActivities(garminCredentials);
  } catch (err) {
    if (err instanceof GarminAuthError) {
      return c.text(err.message, 401);
    }
    if (err instanceof GarminSidecarError && err.status) {
      c.status(err.status as 401 | 403 | 429 | 502);
      return c.text(err.message);
    }
    console.error("[coaching] Garmin sync failure:", err);
    return c.text("Service Unavailable", 503);
  }

  const latest = [...activities]
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))
    .slice(0, query.data.limit);

  // Before OpenRouter is configured, still show the latest activities so the
  // Garmin sync remains useful; analyses appear once setup is complete.
  const settings = await loadLlmSettings();
  if (!settings) {
    return c.json(
      analyzedActivitiesResponseSchema.parse({
        model: null,
        activities: latest.map(withoutAnalysis),
      }),
    );
  }

  let apiKey: string;
  try {
    const key = await llmCredentialsKeyFromEnv();
    apiKey = await decrypt(settings.apiKeyEncrypted, key);
  } catch (err) {
    console.error("[coaching] could not decrypt the OpenRouter API key:", err);
    return c.text(
      "OpenRouter credentials are unavailable (check LLM_CREDENTIALS_KEY)",
      503,
    );
  }

  const cached = query.data.refresh
    ? new Map<number, StoredAnalysis>()
    : await loadAnalyses(
        latest.map((activity) => activity.id),
        settings.model,
        ANALYSIS_PROMPT_VERSION,
      );

  const provider = createOpenRouterProvider();

  let analysed: AnalyzedActivity[];
  try {
    analysed = await mapWithConcurrency(
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
          // A revoked/invalid key affects every activity; surface it instead
          // of returning a list where every card says "analysis failed".
          if (err instanceof LlmAuthError) {
            throw err;
          }
          // Do not echo raw DB errors: Drizzle includes the full SQL and its
          // parameters (including the generated analysis) in the message.
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
  } catch (err) {
    if (err instanceof LlmAuthError) {
      return c.text(err.message, 401);
    }
    if (err instanceof LlmProviderError) {
      return c.text(err.message, 503);
    }
    console.error("[coaching] analysis failure:", err);
    return c.text("Service Unavailable", 503);
  }

  return c.json(
    analyzedActivitiesResponseSchema.parse({
      model: settings.model,
      activities: analysed,
    }),
  );
});
