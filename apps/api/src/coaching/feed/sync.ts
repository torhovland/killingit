import type { Activity, AnalyzedActivity } from "@killingit/shared";
import {
  GarminNotConnectedError,
  syncGarminActivities,
  type GarminCredentials,
} from "../../garmin/client.js";
import { loadDecryptedGarminCredentials } from "../../garmin/credentials.js";
import {
  syncGarminSupplements,
  startGarminSupplements,
} from "../../garmin/supplements.js";
import {
  loadStoredActivityFeed,
  saveStoredActivities,
  summarizeActivity,
} from "../activityStore.js";
import { loadDeletedActivityIds } from "../deletions.js";
import { GarminCredentialsError } from "./errors.js";
import { withoutAnalysis } from "./presenter.js";

/** The newest activities to analyse and every activity ever synced. */
interface SyncedFeed {
  /** The synced activities within the analysis limit, newest first. */
  latest: readonly Activity[];
  /** Every synced activity merged with stored history, newest first. */
  history: AnalyzedActivity[];
}

/**
 * The Garmin calls and the store behind one feed sync, injectable so a test can
 * drive the sync without Garmin or the database. `syncSupplements` is the
 * supplementary work the sync starts in the background; a test supplies a slow
 * or failing pass to prove the feed answers regardless.
 */
export interface FeedSyncDependencies {
  syncActivities?: typeof syncGarminActivities;
  syncSupplements?: typeof syncGarminSupplements;
  loadDeletedIds?: typeof loadDeletedActivityIds;
  store?: ActivityStore;
}

/** The stored credentials, or a typed error the route can report. */
export async function loadGarminCredentials(
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

/**
 * Syncs Garmin activities and starts the supplementary body-metric and
 * daily-health pass in the background, then merges the result with the stored
 * history and stores the sync window before the (potentially slow) LLM
 * analyses, so the feed answers as soon as the activities are stored.
 */
export async function syncFeed(
  params: {
    userId: number;
    credentials: GarminCredentials;
    today: string;
    limit: number;
  },
  deps: FeedSyncDependencies = {},
): Promise<SyncedFeed> {
  const syncActivities = deps.syncActivities ?? syncGarminActivities;
  const syncSupplements = deps.syncSupplements ?? syncGarminSupplements;
  const loadDeletedIds = deps.loadDeletedIds ?? loadDeletedActivityIds;

  const activities = await syncActivities(params.credentials);
  // The weigh-in/FTP refresh and the daily-health backfill take far longer than
  // the activity sync, and the feed's response carries none of them: the shared
  // pass runs in the background, keeps its own failure to itself, and runs once
  // per account at a time. See ADR 0039.
  void startGarminSupplements(params.userId, () =>
    syncSupplements(params.userId, params.credentials, params.today),
  );
  const deletedIds = await loadDeletedIds(params.userId, "garmin");
  const synced = [...activities]
    .filter((activity) => !deletedIds.has(String(activity.id)))
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
  const history = await extendStoredFeed(
    {
      userId: params.userId,
      synced,
      deletedIds,
    },
    deps.store,
  );
  return { latest: synced.slice(0, params.limit), history };
}

/** The activity store reads and writes, injectable so a test can fail the read. */
interface ActivityStore {
  load: typeof loadStoredActivityFeed;
  save: typeof saveStoredActivities;
}

const ACTIVITY_STORE: ActivityStore = {
  load: loadStoredActivityFeed,
  save: saveStoredActivities,
};

/**
 * Merges the synced activities with the stored history and stores the sync.
 * The stored history is read before anything is written, and a failed read
 * aborts the sync: merging the sync window with an empty history would drop
 * every older activity from the response, including its coach work.
 */
export async function extendStoredFeed(
  params: {
    userId: number;
    synced: readonly Activity[];
    deletedIds: ReadonlySet<string>;
  },
  store: ActivityStore = ACTIVITY_STORE,
): Promise<AnalyzedActivity[]> {
  const previous = await loadPreviousActivities(params.userId, store.load);
  const history = mergeActivityHistory(
    previous,
    params.synced,
    params.deletedIds,
  );
  await persistSyncedActivities(
    params.userId,
    params.synced,
    params.deletedIds,
    store.save,
  );
  return history;
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
 * Reads the stored feed so a sync extends it instead of dropping older work.
 * A failed read throws rather than returning an empty history, because merging
 * the sync window with nothing would erase every activity older than that
 * window and its coach analysis, comment and reply.
 */
async function loadPreviousActivities(
  userId: number,
  load: ActivityStore["load"] = loadStoredActivityFeed,
): Promise<readonly AnalyzedActivity[]> {
  try {
    return (await load(userId, "samples")).activities;
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

/**
 * Updates a stored activity's summary from a fresh sync while keeping the
 * coach analysis and athlete feedback already attached to it.
 */
function refreshSyncedActivity(
  previous: AnalyzedActivity,
  activity: Activity,
): AnalyzedActivity {
  return {
    ...summarizeActivity(activity),
    analysis: previous.analysis,
    analysisError: previous.analysisError,
    programAnalysis: previous.programAnalysis,
    comment: previous.comment,
    coachReply: previous.coachReply,
    reviewed: previous.reviewed,
  };
}

/** Stores the sync window; a write failure must not fail the sync response. */
async function persistSyncedActivities(
  userId: number,
  synced: readonly Activity[],
  deletedIds: ReadonlySet<string>,
  save: ActivityStore["save"] = saveStoredActivities,
): Promise<void> {
  try {
    await save(userId, synced, deletedIds);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[coaching] could not store the activity rows: ${detail}`);
  }
}
