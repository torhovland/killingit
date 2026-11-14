import { describe, expect, it, mock, spyOn } from "bun:test";
import type { Activity, AnalyzedActivity } from "@killingit/shared";
import type { GarminCredentials } from "../../garmin/client.js";
import { syncFeed } from "./sync.js";

type SyncFeedDependencies = NonNullable<Parameters<typeof syncFeed>[1]>;

function synced(id: number, startDate: string, name: string): Activity {
  return {
    id,
    name,
    type: "cycling",
    startDate,
    distance: 10000,
    movingTime: 1800,
    elapsedTime: 1900,
    totalElevationGain: 100,
    samples: [],
  };
}

function stored(id: number, startDate: string): AnalyzedActivity {
  return {
    ...synced(id, startDate, `Old ${id}`),
    sampleCount: 0,
    analysis: {
      text: `Analysis ${id}`,
      model: "test-model",
      generatedAt: "2026-10-01T07:00:00Z",
    },
    analysisError: null,
    programAnalysis: null,
    comment: `Comment ${id}`,
    coachReply: null,
  };
}

/** A stored activity whose bulk channels a detail-skipping sync omits. */
function storedWithPreview(id: number, startDate: string): AnalyzedActivity {
  return {
    ...stored(id, startDate),
    sampleCount: 2,
    samples: [
      { timestamp: "2026-10-01T07:00:00Z", heartRate: 130 },
      { timestamp: "2026-10-01T07:01:00Z", heartRate: 132 },
    ],
    averagePower: 200,
    normalizedPower: 210,
    laps: [
      { index: 1, distance: 1000 },
      { index: 2, distance: 2000 },
    ],
    strengthSets: [{ setType: "active", repetitions: 10, exercises: [] }],
  };
}

const credentials: GarminCredentials = {
  username: "rider",
  password: "secret",
};

/** A stored-feed store with no history, so a sync test never touches the database. */
function emptyStore(): NonNullable<SyncFeedDependencies["store"]> {
  return {
    load: () => Promise.resolve({ model: null, activities: [] }),
    save: mock(() => Promise.resolve()),
  };
}

/** Lets a background pass settle so its per-account entry is released. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Runs a sync against a store holding `previous` and returns its history. */
async function syncHistory(options: {
  previous?: readonly AnalyzedActivity[];
  synced?: readonly Activity[];
  deletedIds?: ReadonlySet<string>;
}): Promise<AnalyzedActivity[]> {
  const result = await syncFeed(
    { userId: 1, credentials, today: "2026-11-14", limit: 20 },
    {
      syncActivities: () => Promise.resolve([...(options.synced ?? [])]),
      syncSupplements: () => Promise.resolve(),
      loadDeletedIds: () => Promise.resolve(new Set(options.deletedIds ?? [])),
      store: {
        load: () =>
          Promise.resolve({
            model: null,
            activities: [...(options.previous ?? [])],
          }),
        save: () => Promise.resolve(),
      },
    },
  );
  return result.history;
}

describe("syncFeed merging the stored history", () => {
  it("keeps activities that fell outside the latest sync window", async () => {
    const history = await syncHistory({
      previous: [stored(1, "2026-10-03T06:30:00Z")],
      synced: [synced(2, "2026-10-11T06:30:00Z", "New ride")],
    });

    expect(history.map((activity) => activity.id)).toEqual([2, 1]);
  });

  it("omits a locally deleted activity from both history and a fresh sync", async () => {
    const history = await syncHistory({
      previous: [stored(1, "2026-10-03T06:30:00Z")],
      synced: [
        synced(1, "2026-10-03T06:30:00Z", "Still on Garmin"),
        synced(2, "2026-10-11T06:30:00Z", "New ride"),
      ],
      deletedIds: new Set(["1"]),
    });

    expect(history.map((activity) => activity.id)).toEqual([2]);
  });

  it("updates a synced activity without losing its analysis or feedback", async () => {
    const history = await syncHistory({
      previous: [stored(1, "2026-10-03T06:30:00Z")],
      synced: [synced(1, "2026-10-03T06:30:00Z", "Renamed ride")],
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.name).toBe("Renamed ride");
    expect(history[0]?.analysis?.text).toBe("Analysis 1");
    expect(history[0]?.comment).toBe("Comment 1");
  });

  it("does not store a sync when the stored feed cannot be read", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const store: NonNullable<SyncFeedDependencies["store"]> = {
      load: () => Promise.reject(new Error("connection reset")),
      save: mock(() => Promise.resolve()),
    };

    let caught: unknown;
    try {
      await syncFeed(
        { userId: 1, credentials, today: "2026-11-14", limit: 20 },
        {
          syncActivities: () =>
            Promise.resolve([synced(2, "2026-10-11T06:30:00Z", "New ride")]),
          syncSupplements: () => Promise.resolve(),
          loadDeletedIds: () => Promise.resolve(new Set()),
          store,
        },
      );
    } catch (err) {
      caught = err;
    } finally {
      log.mockRestore();
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : "").toBe(
      "The stored activity feed could not be read",
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it("stores only the synced window when the stored feed can be read", async () => {
    const store: NonNullable<SyncFeedDependencies["store"]> = {
      load: () =>
        Promise.resolve({
          model: null,
          activities: [stored(1, "2026-10-03T06:30:00Z")],
        }),
      save: mock(() => Promise.resolve()),
    };
    const deletedIds = new Set(["3"]);

    const result = await syncFeed(
      { userId: 1, credentials, today: "2026-11-14", limit: 20 },
      {
        syncActivities: () =>
          Promise.resolve([synced(2, "2026-10-11T06:30:00Z", "New ride")]),
        syncSupplements: () => Promise.resolve(),
        loadDeletedIds: () => Promise.resolve(deletedIds),
        store,
      },
    );

    expect(result.history.map((activity) => activity.id)).toEqual([2, 1]);
    expect(store.save).toHaveBeenCalledWith(
      1,
      [synced(2, "2026-10-11T06:30:00Z", "New ride")],
      deletedIds,
      [stored(1, "2026-10-03T06:30:00Z")],
    );
  });
});

describe("syncFeed", () => {
  it("answers with the synced activities while the supplementary pass runs", async () => {
    let finish: () => void = () => {};
    const syncSupplements = mock(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const result = await syncFeed(
      { userId: 29911, credentials, today: "2026-11-14", limit: 20 },
      {
        syncActivities: () =>
          Promise.resolve([synced(2, "2026-10-11T06:30:00Z", "New ride")]),
        syncSupplements,
        loadDeletedIds: () => Promise.resolve(new Set()),
        store: emptyStore(),
      },
    );

    expect(result.latest.map((activity) => activity.name)).toEqual([
      "New ride",
    ]);
    expect(result.history.map((activity) => activity.id)).toEqual([2]);
    expect(syncSupplements).toHaveBeenCalledWith(
      29911,
      credentials,
      "2026-11-14",
    );

    finish();
    await settle();
  });

  it("answers with the synced activities when the supplementary pass fails", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await syncFeed(
        { userId: 29912, credentials, today: "2026-11-14", limit: 20 },
        {
          syncActivities: () =>
            Promise.resolve([
              synced(3, "2026-10-12T06:30:00Z", "Another ride"),
            ]),
          syncSupplements: () => Promise.reject(new Error("sidecar down")),
          loadDeletedIds: () => Promise.resolve(new Set()),
          store: emptyStore(),
        },
      );

      expect(result.history.map((activity) => activity.id)).toEqual([3]);

      await settle();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[1])).toContain("sidecar down");
    } finally {
      log.mockRestore();
    }
  });

  it("passes the stored ids and keeps a skipped activity's stored preview", async () => {
    const previous = storedWithPreview(1, "2026-10-03T06:30:00Z");
    const knownIds: (readonly number[])[] = [];
    const store = {
      load: () => Promise.resolve({ model: null, activities: [previous] }),
      save: mock(() => Promise.resolve()),
    };

    const result = await syncFeed(
      { userId: 29914, credentials, today: "2026-11-14", limit: 20 },
      {
        // Garmin still reports the activity, with its fresh summary but none of
        // the bulk payloads the sidecar skipped.
        syncActivities: (_credentials, ids = []) => {
          knownIds.push(ids);
          return Promise.resolve([
            { ...synced(1, "2026-10-03T06:30:00Z", "Renamed ride") },
          ]);
        },
        syncSupplements: () => Promise.resolve(),
        loadDeletedIds: () => Promise.resolve(new Set()),
        store,
      },
    );

    expect(knownIds).toEqual([[1]]);
    expect(result.history[0]).toMatchObject({
      name: "Renamed ride",
      sampleCount: 2,
      averagePower: 200,
      normalizedPower: 210,
    });
    expect(result.history[0]?.samples).toHaveLength(2);
    expect(result.history[0]?.laps).toHaveLength(2);
    expect(result.history[0]?.strengthSets).toHaveLength(1);
    // The analysis reads the stored preview rather than the empty payload.
    expect(result.latest[0]?.samples).toHaveLength(2);
    expect(store.save).toHaveBeenCalledWith(
      29914,
      expect.any(Array),
      expect.any(Set),
      [previous],
    );
  });

  it("does not start the supplementary pass when the activity sync fails", async () => {
    const syncSupplements = mock(() => Promise.resolve());

    let caught: unknown;
    try {
      await syncFeed(
        { userId: 29913, credentials, today: "2026-11-14", limit: 20 },
        {
          syncActivities: () => Promise.reject(new Error("Garmin is down")),
          syncSupplements,
          loadDeletedIds: () => Promise.resolve(new Set()),
          store: emptyStore(),
        },
      );
    } catch (err) {
      caught = err;
    }

    expect(String(caught)).toContain("Garmin is down");
    expect(syncSupplements).not.toHaveBeenCalled();
  });
});
