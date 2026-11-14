import { zonedDateTime } from "@killingit/shared";
import { shareActivityAnalysis } from "./analysisRuns.js";
import {
  analyzeMissing,
  loadAnalysisInputs,
  loadLlmApiKey,
} from "./feed/analysis.js";
import { assembleFeed, type ActivityFeed } from "./feed/presenter.js";
import { loadGarminCredentials, syncFeed } from "./feed/sync.js";
import { assertModelUsable } from "../llm/client.js";
import { withPromptLogging } from "../llm/callLog.js";
import {
  createOpenRouterProvider,
  type LlmProvider,
} from "../llm/openrouter.js";

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
    history: synced.history,
    inputs,
    model,
    analyses: outcomes.map((outcome) => outcome.activity),
    timezone: options.timezone,
  });
}
