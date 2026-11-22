import "./setup.js";
import { describe, expect, it } from "bun:test";
import type { Activity } from "@killingit/shared";
import {
  loadStoredActivityFeed,
  saveStoredActivities,
} from "../src/coaching/activityStore.js";
import { deleteImportedActivity } from "../src/coaching/deletions.js";
import { saveAnalysis } from "../src/llm/analysisStore.js";
import {
  createActivityComment,
  loadCoachingInputs,
} from "../src/plans/inputs.js";
import { saveCoachReply } from "../src/plans/replies.js";
import { dbUserStore } from "../src/users/store.js";
import { countRows } from "./database.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

function syncedActivity(
  id: number,
  startDate: string,
  name = "Morning ride",
): Activity {
  return {
    id,
    name,
    type: "cycling",
    startDate,
    distance: 20000,
    movingTime: 3600,
    elapsedTime: 3700,
    totalElevationGain: 200,
    samples: [
      {
        timestamp: "2026-10-01T07:00:00Z",
        latitude: 59.9,
        longitude: 10.7,
        power: 200,
      },
      {
        timestamp: "2026-10-01T07:01:00Z",
        latitude: 59.91,
        longitude: 10.71,
        power: 210,
      },
    ],
  };
}

describe("stored activity rows", () => {
  it("stores one row per activity and updates a re-synced activity in place", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-rows");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z", "Renamed ride"),
    ]);

    const feed = await loadStoredActivityFeed(user.id, "samples");

    expect(feed.activities).toHaveLength(1);
    expect(feed.activities[0]?.name).toBe("Renamed ride");
    expect(feed.activities[0]?.sampleCount).toBe(2);
    expect(feed.activities[0]?.samples).toHaveLength(2);
  });

  it("refreshes every stored column from a full re-sync", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-all-columns");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);
    const resynced: Activity = {
      ...syncedActivity(1, "2026-10-02T08:00:00Z", "Renamed ride"),
      type: "running",
      distance: 30000,
      movingTime: 7200,
      elapsedTime: 7400,
      totalElevationGain: 400,
      averageHeartRate: 150,
      averageSpeed: 4.2,
      maxSpeed: 5.5,
      laps: [
        { index: 1, distance: 1000 },
        { index: 2, distance: 2000 },
      ],
      strengthSets: [{ setType: "active", repetitions: 10, exercises: [] }],
      samples: [
        {
          timestamp: "2026-10-02T08:00:00Z",
          latitude: 59.9,
          longitude: 10.7,
          power: 300,
        },
        {
          timestamp: "2026-10-02T08:01:00Z",
          latitude: 59.91,
          longitude: 10.71,
          power: 310,
        },
      ],
    };
    await saveStoredActivities(user.id, [resynced]);

    const [activity] = (await loadStoredActivityFeed(user.id, "samples"))
      .activities;

    expect(activity).toMatchObject({
      name: "Renamed ride",
      type: "running",
      startDate: "2026-10-02T08:00:00.000Z",
      distance: 30000,
      movingTime: 7200,
      elapsedTime: 7400,
      totalElevationGain: 400,
      averagePower: 300,
      averageHeartRate: 150,
      averageSpeed: 4.2,
      maxSpeed: 5.5,
      sampleCount: 2,
    });
    expect(activity?.normalizedPower).toBeDefined();
    expect(activity?.laps).toHaveLength(2);
    expect(activity?.strengthSets).toHaveLength(1);
    expect(activity?.samples).toHaveLength(2);
    expect(activity?.route).toHaveLength(2);
  });

  it("keeps the preview, laps and sets when a re-sync has no details", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-preview-kept");
    const full: Activity = {
      ...syncedActivity(1, "2026-10-01T07:00:00Z"),
      laps: [
        { index: 1, distance: 1000 },
        { index: 2, distance: 2000 },
      ],
      strengthSets: [{ setType: "active", repetitions: 10, exercises: [] }],
    };
    await saveStoredActivities(user.id, [full]);
    const previous = (await loadStoredActivityFeed(user.id, "samples"))
      .activities;

    // The sidecar skips the bulk calls for an activity the API already stores,
    // so the re-sync returns its renamed summary with no samples, laps or sets.
    await saveStoredActivities(
      user.id,
      [
        {
          ...syncedActivity(1, "2026-10-01T07:00:00Z", "Renamed ride"),
          samples: [],
        },
      ],
      new Set(),
      previous,
    );

    const feed = await loadStoredActivityFeed(user.id, "samples");
    const activity = feed.activities[0];

    expect(activity?.name).toBe("Renamed ride");
    expect(activity?.sampleCount).toBe(2);
    expect(activity?.samples).toHaveLength(2);
    expect(activity?.route).toHaveLength(2);
    expect(activity?.averagePower).toBeDefined();
    expect(activity?.laps).toHaveLength(2);
    expect(activity?.strengthSets).toHaveLength(1);
  });

  it("loads the sample preview and route only when they are asked for", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-preview");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);

    const summary = await loadStoredActivityFeed(user.id);
    expect(summary.activities[0]?.samples).toEqual([]);
    expect(summary.activities[0]?.route).toBeUndefined();

    const routed = await loadStoredActivityFeed(user.id, "route");
    expect(routed.activities[0]?.route).toHaveLength(2);
    expect(routed.activities[0]?.samples).toEqual([]);

    const full = await loadStoredActivityFeed(user.id, "samples");
    expect(full.activities[0]?.samples).toHaveLength(2);
    expect(full.activities[0]?.route).toHaveLength(2);
  });

  it("filters and orders every preview scope the same way", async () => {
    const owner = await dbUserStore.ensureUser("auth0|activity-scope-owner");
    const other = await dbUserStore.ensureUser("auth0|activity-scope-other");
    await saveStoredActivities(owner.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
      syncedActivity(2, "2026-10-03T07:00:00Z"),
    ]);
    await saveStoredActivities(other.id, [
      syncedActivity(3, "2026-10-05T07:00:00Z"),
    ]);

    for (const scope of ["none", "route", "samples"] as const) {
      const feed = await loadStoredActivityFeed(owner.id, scope);
      expect(feed.activities.map((activity) => activity.id)).toEqual([2, 1]);
    }
  });

  it("keeps the stored history newest first and drops a deleted activity", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-deletion");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
      syncedActivity(2, "2026-10-03T07:00:00Z"),
    ]);
    await saveStoredActivities(user.id, [], new Set(["2"]));

    const feed = await loadStoredActivityFeed(user.id);

    expect(feed.activities.map((activity) => activity.id)).toEqual([1]);
  });

  it("removes the activity and its coach work when the athlete deletes it", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-delete-row");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);
    await saveAnalysis({
      userId: user.id,
      activityId: 1,
      model: "test-model",
      promptVersion: 1,
      text: "A steady aerobic ride.",
      planChangeNeeded: false,
      planChangeScope: "none",
    });

    await deleteImportedActivity(user.id, "1");

    expect(await loadStoredActivityFeed(user.id)).toEqual({
      model: null,
      activities: [],
    });
    expect(await countRows("activities")).toBe(0);
    expect(await countRows("activity_analyses")).toBe(0);
  });

  it("attaches the stored analysis and athlete comment to the feed", async () => {
    const user = await dbUserStore.ensureUser("auth0|activity-coach-work");
    await saveStoredActivities(user.id, [
      syncedActivity(1, "2026-10-01T07:00:00Z"),
    ]);
    await saveAnalysis({
      userId: user.id,
      activityId: 1,
      model: "test-model",
      promptVersion: 1,
      text: "A steady aerobic ride.",
      planChangeNeeded: true,
      planChangeScope: "day",
    });
    await createActivityComment(user.id, {
      activityId: "1",
      comment: "Felt strong.",
    });
    await saveCoachReply({
      userId: user.id,
      kind: "activity_comment",
      target: "1",
      reply: "A shorter session tomorrow, then back to the plan.",
      model: "test-model",
      planChangeNeeded: true,
      planChangeScope: "day",
    });

    const feed = await loadStoredActivityFeed(user.id);

    expect(feed.activities[0]?.analysis?.text).toBe("A steady aerobic ride.");
    expect(feed.activities[0]?.analysis?.planChangeScope).toBe("day");
    expect(feed.activities[0]?.comment).toBe("Felt strong.");
    expect(feed.activities[0]?.coachReply?.planChangeScope).toBe("day");

    const inputs = await loadCoachingInputs(user.id, "2026-09-28");
    const refreshChanges = inputs.refreshChanges ?? [];
    expect(refreshChanges).toHaveLength(1);
    expect(inputs.updatedAt).not.toBeNull();
    expect(refreshChanges[0]?.updatedAt.getTime()).toBe(
      inputs.updatedAt?.getTime(),
    );
    expect(refreshChanges[0]?.planChangeScope).toBe("day");
    expect(inputs.refreshUpdatedAt?.getTime()).toBe(
      inputs.updatedAt?.getTime(),
    );
  });
});
