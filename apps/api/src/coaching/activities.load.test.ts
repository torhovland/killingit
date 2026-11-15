import { describe, expect, it, mock } from "bun:test";
import type { Activity, AnalyzedActivity } from "@killingit/shared";
import { LlmModelChoiceError, type LlmClient } from "../llm/client.js";
import type { LlmProvider } from "../llm/openrouter.js";
import { EMPTY_ACTIVITY_LOADS } from "../training/activityLoad.js";
import { loadAnalyzedActivities } from "./activities.js";
import { LlmCredentialsError } from "./feed/errors.js";

type Phases = NonNullable<Parameters<typeof loadAnalyzedActivities>[1]>;
type Inputs = Awaited<ReturnType<Phases["loadAnalysisInputs"]>>;

const activity: Activity = {
  id: 1,
  name: "Morning ride",
  type: "cycling",
  startDate: "2026-11-11T07:00:00Z",
  distance: 30000,
  movingTime: 3600,
  elapsedTime: 3700,
  totalElevationGain: 200,
  samples: [],
};

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

const clientProvider: LlmProvider = { ...provider, id: "client" };

function client(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    provider: clientProvider,
    apiKey: "decrypted-key",
    seasonModel: "season-model",
    dailyModel: "daily-model",
    ...overrides,
  };
}

function inputs(): Inputs {
  return {
    feedback: new Map(),
    storedPlan: null,
    dailyHealth: undefined,
    bodyHistory: undefined,
    diet: null,
    ftpHistory: [],
    ftp: null,
    thresholds: [],
    loads: EMPTY_ACTIVITY_LOADS,
  };
}

/** The real phases behind one load, with each one replaceable by a spy. */
function phaseSpies(
  loadLlmClient: () => Promise<LlmClient | null> = () =>
    Promise.resolve(client()),
) {
  return {
    loadGarminCredentials: mock(() =>
      Promise.resolve({ username: "athlete", password: "secret" }),
    ),
    syncFeed: mock(() =>
      Promise.resolve({ latest: [activity], history: [analyzed] }),
    ),
    loadAnalysisInputs: mock(() => Promise.resolve(inputs())),
    analyzeMissing: mock(
      (): Promise<Awaited<ReturnType<Phases["analyzeMissing"]>>> =>
        Promise.resolve([]),
    ),
    assembleFeed: mock(
      (params: {
        model: string | null;
        analyses: readonly AnalyzedActivity[];
      }) => ({
        model: params.model,
        activities: [analyzed],
      }),
    ),
    loadLlmClient: mock(loadLlmClient),
  };
}

function phases(spies: ReturnType<typeof phaseSpies>): Phases {
  return spies;
}

describe("loadAnalyzedActivities", () => {
  it("returns the synced feed without analyses when no LLM is configured", async () => {
    const spies = phaseSpies(() => Promise.resolve(null));
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
    expect(spies.loadLlmClient).toHaveBeenCalledWith(9001, "daily");
    expect(spies.analyzeMissing).not.toHaveBeenCalled();
    expect(spies.assembleFeed).toHaveBeenCalledWith({
      history: [analyzed],
      inputs: inputs(),
      model: null,
      analyses: [],
    });
  });

  it("analyses with the account's daily client and assembles the returned feed", async () => {
    const spies = phaseSpies(() => Promise.resolve(client()));
    spies.analyzeMissing.mockImplementation(() =>
      Promise.resolve([{ activity: analyzed }]),
    );

    const result = await loadAnalyzedActivities(
      {
        userId: 9002,
        limit: 20,
        refresh: false,
        today: "2026-11-12",
      },
      phases(spies),
    );

    expect(spies.loadLlmClient).toHaveBeenCalledWith(9002, "daily");
    expect(spies.analyzeMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9002,
        provider: clientProvider,
        apiKey: "decrypted-key",
        model: "daily-model",
        latest: [activity],
        refresh: false,
      }),
    );
    expect(spies.assembleFeed).toHaveBeenCalledWith({
      history: [analyzed],
      inputs: inputs(),
      model: "daily-model",
      analyses: [analyzed],
    });
    expect(result).toEqual({ model: "daily-model", activities: [analyzed] });
  });

  it("uses the caller's provider when one is injected", async () => {
    const spies = phaseSpies();

    await loadAnalyzedActivities(
      {
        userId: 9003,
        limit: 20,
        refresh: false,
        today: "2026-11-12",
        provider,
      },
      phases(spies),
    );

    expect(spies.analyzeMissing).toHaveBeenCalledWith(
      expect.objectContaining({ provider }),
    );
  });

  it("reports a client failure as unavailable LLM credentials", async () => {
    const spies = phaseSpies(() =>
      Promise.reject(new Error("could not decrypt the key")),
    );

    const err = await loadAnalyzedActivities(
      {
        userId: 9004,
        limit: 20,
        refresh: false,
        today: "2026-11-12",
        provider,
      },
      phases(spies),
    ).catch((failure: unknown) => failure);

    if (!(err instanceof LlmCredentialsError)) {
      throw new Error("expected the feed to raise LlmCredentialsError");
    }
    expect(err.message).toBe(
      "OpenRouter credentials are unavailable (check LLM_CREDENTIALS_KEY)",
    );
    expect(spies.analyzeMissing).not.toHaveBeenCalled();
  });

  it("passes a retired-model failure through unchanged", async () => {
    const retired = new LlmModelChoiceError(
      "Your day-to-day model daily-model is retired. Open Settings and choose another model.",
    );
    const spies = phaseSpies(() => Promise.reject(retired));

    const err = await loadAnalyzedActivities(
      {
        userId: 9005,
        limit: 20,
        refresh: false,
        today: "2026-11-12",
        provider,
      },
      phases(spies),
    ).catch((failure: unknown) => failure);

    expect(err).toBe(retired);
    expect(spies.analyzeMissing).not.toHaveBeenCalled();
  });
});
