import { describe, expect, it, mock } from "bun:test";
import type { Activity, AnalyzedActivity } from "@killingit/shared";
import type { LlmProvider } from "../../llm/openrouter.js";
import { extendStoredFeed, loadAnalyzedActivities } from "./sync.js";

type Phases = NonNullable<Parameters<typeof loadAnalyzedActivities>[1]>;
type Inputs = Awaited<ReturnType<Phases["loadAnalysisInputs"]>>;
type Settings = Inputs["settings"];
type FeedCache = NonNullable<Parameters<typeof extendStoredFeed>[1]>;

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

const activity = synced(1, "2026-11-11T07:00:00Z", "Morning ride");

const analyzed: AnalyzedActivity = {
  ...activity,
  sampleCount: 0,
  analysis: null,
  analysisError: null,
  programAnalysis: null,
  comment: null,
  coachReply: null,
  reviewed: false,
};

const feed = { model: null, activities: [analyzed] };

const provider: LlmProvider = {
  id: "test",
  listModels: () => Promise.resolve([]),
  validateKey: () => Promise.resolve(),
  complete: () => Promise.resolve(""),
};

function inputs(settings: Settings): Inputs {
  return {
    settings,
    feedback: new Map(),
    storedPlan: null,
    dailyHealth: undefined,
    bodyHistory: undefined,
    diet: null,
    ftpHistory: [],
    ftp: null,
    thresholds: [],
    loads: { byDate: new Map(), byActivityId: new Map() },
  };
}

/** The real phases behind one load, with each one replaceable by a spy. */
function phaseSpies(settings: Settings) {
  return {
    loadGarminCredentials: mock(() =>
      Promise.resolve({ username: "athlete", password: "secret" }),
    ),
    syncFeed: mock(() =>
      Promise.resolve({ latest: [activity], history: [analyzed] }),
    ),
    loadAnalysisInputs: mock(() => Promise.resolve(inputs(settings))),
    analyzeMissing: mock(
      (): Promise<Awaited<ReturnType<Phases["analyzeMissing"]>>> =>
        Promise.resolve([]),
    ),
    assembleFeed: mock(
      (params: {
        model: string | null;
        analyses: readonly AnalyzedActivity[];
      }) =>
        Promise.resolve({
          model: params.model,
          activities: [analyzed],
        }),
    ),
    assertModelUsable: mock(() => Promise.resolve()),
    loadLlmApiKey: mock(() => Promise.resolve("decrypted-key")),
  };
}

function phases(spies: ReturnType<typeof phaseSpies>): Phases {
  return spies;
}

describe("loadAnalyzedActivities", () => {
  it("returns the synced feed without analyses when no LLM is configured", async () => {
    const spies = phaseSpies(null);
    const result = await loadAnalyzedActivities(
      {
        userId: 9001,
        limit: 20,
        refresh: true,
        today: "2026-11-12",
        provider,
      },
      phases(spies),
    );

    expect(result).toEqual(feed);
    expect(spies.syncFeed).toHaveBeenCalledWith({
      userId: 9001,
      credentials: { username: "athlete", password: "secret" },
      today: "2026-11-12",
      limit: 20,
    });
    expect(spies.analyzeMissing).not.toHaveBeenCalled();
    expect(spies.assertModelUsable).not.toHaveBeenCalled();
    expect(spies.assembleFeed).toHaveBeenCalledWith({
      userId: 9001,
      history: [analyzed],
      inputs: inputs(null),
      model: null,
      analyses: [],
    });
  });

  it("analyses with the daily model and assembles the returned feed", async () => {
    const settings = {
      provider: "openrouter",
      apiKeyEncrypted: "encrypted",
      model: "season-model",
      dailyModel: "daily-model",
    };
    const spies = phaseSpies(settings);
    spies.analyzeMissing.mockImplementation(() =>
      Promise.resolve([{ activity: analyzed }]),
    );

    const result = await loadAnalyzedActivities(
      {
        userId: 9002,
        limit: 20,
        refresh: false,
        today: "2026-11-12",
        provider,
      },
      phases(spies),
    );

    expect(spies.assertModelUsable).toHaveBeenCalledWith(
      "daily-model",
      "daily",
    );
    expect(spies.loadLlmApiKey).toHaveBeenCalledWith(settings);
    expect(spies.analyzeMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9002,
        provider,
        apiKey: "decrypted-key",
        model: "daily-model",
        latest: [activity],
        refresh: false,
      }),
    );
    expect(spies.assembleFeed).toHaveBeenCalledWith({
      userId: 9002,
      history: [analyzed],
      inputs: inputs(settings),
      model: "daily-model",
      analyses: [analyzed],
    });
    expect(result).toEqual({ model: "daily-model", activities: [analyzed] });
  });

  it("falls back to the single stored model when no daily model is set", async () => {
    const settings = {
      provider: "openrouter",
      apiKeyEncrypted: "encrypted",
      model: "only-model",
    };
    const spies = phaseSpies(settings);

    await loadAnalyzedActivities(
      {
        userId: 9003,
        limit: 20,
        refresh: true,
        today: "2026-11-12",
        provider,
      },
      phases(spies),
    );

    expect(spies.assertModelUsable).toHaveBeenCalledWith("only-model", "daily");
    expect(spies.analyzeMissing).toHaveBeenCalledWith(
      expect.objectContaining({ model: "only-model" }),
    );
  });
});

describe("extendStoredFeed", () => {
  it("does not store a sync when the stored feed cannot be read", async () => {
    const cache: FeedCache = {
      load: () => Promise.reject(new Error("connection reset")),
      save: mock(() => Promise.resolve()),
    };

    let caught: unknown;
    try {
      await extendStoredFeed(
        {
          userId: 1,
          synced: [synced(2, "2026-10-11T06:30:00Z", "New ride")],
          deletedIds: new Set(),
        },
        cache,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : "").toBe(
      "The stored activity feed could not be read",
    );
    expect(cache.save).not.toHaveBeenCalled();
  });

  it("stores the merged history when the stored feed can be read", async () => {
    const cache: FeedCache = {
      load: () =>
        Promise.resolve({
          model: null,
          activities: [stored(1, "2026-10-03T06:30:00Z")],
        }),
      save: mock(() => Promise.resolve()),
    };

    const history = await extendStoredFeed(
      {
        userId: 1,
        synced: [synced(2, "2026-10-11T06:30:00Z", "New ride")],
        deletedIds: new Set(),
      },
      cache,
    );

    expect(history.map((activity) => activity.id)).toEqual([2, 1]);
    expect(cache.save).toHaveBeenCalledWith(1, {
      model: null,
      activities: history,
    });
  });
});
