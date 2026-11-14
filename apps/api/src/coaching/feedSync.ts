import type { Activity } from "@killingit/shared";
import {
  syncGarminActivities,
  type GarminCredentials,
} from "../garmin/client.js";
import {
  syncGarminSupplements,
  type GarminSupplementDependencies,
} from "../garmin/supplements.js";
import { loadDeletedActivityIds } from "./deletions.js";

/** The activity sync and history reads behind one Garmin feed sync. */
export interface GarminFeedSyncDependencies extends GarminSupplementDependencies {
  /** Injectable for tests; defaults to the sidecar client. */
  syncActivities?: typeof syncGarminActivities;
  /** Injectable for tests; defaults to the database-backed store. */
  loadDeletedIds?: typeof loadDeletedActivityIds;
}

export interface GarminFeedSyncParams {
  userId: number;
  credentials: GarminCredentials;
  /** The athlete's local calendar date. */
  today: string;
}

export interface GarminFeedSyncResult {
  /** Synced activities, with locally deleted ones omitted. */
  activities: Activity[];
  /** The locally deleted activity IDs, for the stored-history merge. */
  deletedIds: ReadonlySet<string>;
}

/**
 * Pulls the newest activities from Garmin, then refreshes the supplementary
 * metrics through `syncGarminSupplements`. A failing activity sync throws,
 * while a failing supplement pass is logged and never hides the activities.
 * Locally deleted activities are dropped and their IDs returned so the caller
 * can merge the result with the stored history.
 */
export async function syncGarminFeed(
  params: GarminFeedSyncParams,
  deps: GarminFeedSyncDependencies = {},
): Promise<GarminFeedSyncResult> {
  const syncActivities = deps.syncActivities ?? syncGarminActivities;
  const loadDeletedIds = deps.loadDeletedIds ?? loadDeletedActivityIds;

  const activities = await syncActivities(params.credentials);
  await syncGarminSupplements(
    params.userId,
    params.credentials,
    params.today,
    deps,
  );
  const deletedIds = await loadDeletedIds(params.userId, "garmin");
  return {
    activities: activities.filter(
      (activity) => !deletedIds.has(String(activity.id)),
    ),
    deletedIds,
  };
}
