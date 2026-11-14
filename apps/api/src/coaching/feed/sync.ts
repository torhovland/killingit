import {
  zonedDateTime,
  type Activity,
  type AnalyzedActivity,
} from "@killingit/shared";
import { decrypt } from "../../crypto/credentials.js";
import type { GarminCredentials } from "../../garmin/client.js";
import {
  GarminNotConnectedError,
  loadDecryptedGarminCredentials,
} from "../../garmin/credentials.js";
import { withPromptLogging } from "../../llm/callLog.js";
import { assertModelUsable } from "../../llm/client.js";
import { llmCredentialsKeyFromEnv } from "../../llm/credentials.js";
import {
  createOpenRouterProvider,
  type LlmProvider,
} from "../../llm/openrouter.js";
import type { StoredLlmSettings } from "../../llm/store.js";
import { shareActivityAnalysis } from "../analysisRuns.js";
import {
  loadCachedActivityFeed,
  saveCachedActivityFeed,
} from "../feedCache.js";
import { syncGarminFeed } from "../feedSync.js";
import {
  analyzeMissing,
  loadAnalysisInputs,
  type AnalysisInputs,
} from "./analysis.js";
import { GarminCredentialsError, LlmCredentialsError } from "./errors.js";
import {
  mergeActivityHistory,
  withActivityLoad,
  withFeedback,
  type ActivityFeed,
} from "./presenter.js";

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
  // Resolve the day before entering the registry so the pass is keyed by the
  // day the caller asked for, not by the moment a queued pass finally starts.
  const today =
    options.today ?? zonedDateTime(new Date(), options.timezone).date;
  return shareActivityAnalysis(options.userId, today, options.refresh, () =>
    loadAnalyzedActivitiesOnce(options, today, phases),
  );
}

async function loadAnalyzedActivitiesOnce(
  options: AnalyzeActivitiesOptions,
  today: string,
  phases: ActivityFeedPhases,
): Promise<ActivityFeed> {
  const provider =
    options.provider ??
    withPromptLogging(createOpenRouterProvider(), { userId: options.userId });
  const credentials = await phases.loadGarminCredentials(options.userId);

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
  const { activities, deletedIds } = await syncGarminFeed(params);
  const synced = [...activities].sort(
    (a, b) => Date.parse(b.startDate) - Date.parse(a.startDate),
  );
  const history = await extendStoredFeed({
    userId: params.userId,
    synced,
    deletedIds,
  });
  return { latest: synced.slice(0, params.limit), history };
}

/** The feed cache reads and writes, injectable so a test can fail the read. */
interface FeedCache {
  load: typeof loadCachedActivityFeed;
  save: typeof saveCachedActivityFeed;
}

const FEED_CACHE: FeedCache = {
  load: loadCachedActivityFeed,
  save: saveCachedActivityFeed,
};

/**
 * Merges the synced activities with the stored history and stores the result.
 * The stored feed is read before anything is written, and a failed read aborts
 * the sync: merging the sync window with an empty history would overwrite every
 * older activity, including its analysis, comment and reply.
 */
export async function extendStoredFeed(
  params: {
    userId: number;
    synced: readonly Activity[];
    deletedIds: ReadonlySet<string>;
  },
  cache: FeedCache = FEED_CACHE,
): Promise<AnalyzedActivity[]> {
  const previous = await loadPreviousActivities(params.userId, cache.load);
  const history = mergeActivityHistory(
    previous,
    params.synced,
    params.deletedIds,
  );
  await persistFeed(
    params.userId,
    { model: null, activities: history },
    cache.save,
  );
  return history;
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
 * Reads the stored feed so a sync extends it instead of dropping older work.
 * A failed read throws rather than returning an empty history, because merging
 * the sync window with nothing would erase every activity older than that
 * window and its coach analysis, comment and reply.
 */
async function loadPreviousActivities(
  userId: number,
  load: FeedCache["load"] = loadCachedActivityFeed,
): Promise<readonly AnalyzedActivity[]> {
  try {
    return (await load(userId))?.activities ?? [];
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[coaching] could not read the stored activity feed: ${detail}`,
    );
    throw new Error("The stored activity feed could not be read", {
      cause: err,
    });
  }
}

/** Stores the feed for a fast first paint; a cache failure must not fail sync. */
async function persistFeed(
  userId: number,
  feed: ActivityFeed,
  save: FeedCache["save"] = saveCachedActivityFeed,
): Promise<void> {
  try {
    await save(userId, feed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[coaching] could not cache the activity feed: ${detail}`);
  }
}
