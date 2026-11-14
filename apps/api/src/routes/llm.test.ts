import { describe, expect, it, spyOn } from "bun:test";
import type { LlmCatalogModel, LlmCostsResponse } from "@killingit/shared";
import { keyFromRaw } from "../crypto/credentials.js";
import { createApp } from "../index.js";
import {
  LlmAuthError,
  LlmProviderError,
  LlmRateLimitError,
  type LlmProvider,
} from "../llm/openrouter.js";
import type { StoredLlmSettings } from "../llm/store.js";
import type { UserStore } from "../users/store.js";
import { apiRequest } from "../testFixtures/request.js";

const userStore: UserStore = {
  ensureUser: (sub) =>
    Promise.resolve({
      id: 42,
      sub,
      role: "member",
      timezone: null,
      location: null,
      dietAdvice: false,
      createdAt: new Date(0),
    }),
  getById: (id) =>
    Promise.resolve({
      id,
      sub: "athlete-1",
      role: "member",
      timezone: null,
      location: null,
      dietAdvice: false,
      createdAt: new Date(0),
    }),
  deleteUser: () => Promise.resolve(),
  updateSettings: (sub, settings) =>
    Promise.resolve({
      id: 42,
      sub,
      role: "member",
      timezone: settings.timezone ?? null,
      location: settings.location ?? null,
      dietAdvice: false,
      createdAt: new Date(0),
    }),
};

const stored: StoredLlmSettings = {
  provider: "openrouter",
  apiKeyEncrypted: "encrypted-secret",
  model: "test-model",
};

const fakeProvider: LlmProvider = {
  id: "openrouter",
  listModels: () => Promise.resolve([]),
  validateKey: (apiKey) =>
    apiKey === "valid-key"
      ? Promise.resolve()
      : Promise.reject(new LlmAuthError("invalid OpenRouter API key")),
  complete: () => Promise.resolve(""),
};

function catalogModel(id: string): LlmCatalogModel {
  return {
    id,
    name: id,
    retired: false,
    discouraged: false,
    ability: "A",
    speed: "A",
    cost: "A",
    benchmarkScore: 10,
    benchmarkTimeMs: 10_000,
    benchmarkCostUsd: 0.01,
    benchmarkedAt: "2026-10-31T15:40:52.865Z",
  };
}

function makeApp(
  loadSettings: (userId: number) => Promise<StoredLlmSettings | null>,
  extras: {
    loadCatalog?: () => Promise<LlmCatalogModel[]>;
    refreshCatalog?: () => Promise<{
      checked: boolean;
      added: number;
      retired: number;
      rescored: number;
      reassigned: number;
      copied: number;
      removed: number;
      error: string | null;
    }>;
    saveSettings?: (
      userId: number,
      settings: StoredLlmSettings,
    ) => Promise<void>;
    provider?: LlmProvider;
    credentialsKey?: () => Promise<CryptoKey>;
    loadCosts?: (userId: number) => Promise<LlmCostsResponse>;
  } = {},
) {
  const app = createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore,
    loadLlmSettings: loadSettings,
    saveLlmSettings: extras.saveSettings,
    loadLlmCosts: extras.loadCosts,
    loadModelCatalog: extras.loadCatalog,
    refreshModelCatalog: extras.refreshCatalog,
    llmProvider: extras.provider,
    llmCredentialsKey: extras.credentialsKey,
  });
  return app;
}

function settingsRequest(): Request {
  return apiRequest("http://localhost/api/llm/settings", {
    headers: { authorization: "Bearer anything" },
  });
}

function putSettingsRequest(body: unknown): Request {
  return apiRequest("http://localhost/api/llm/settings", {
    method: "PUT",
    headers: {
      authorization: "Bearer anything",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("GET /llm/settings", () => {
  it("loads the signed-in account's settings", async () => {
    const userIds: number[] = [];
    const app = makeApp((userId) => {
      userIds.push(userId);
      return Promise.resolve(stored);
    });

    const res = await app.fetch(settingsRequest());

    expect(res.status).toBe(200);
    expect(userIds).toEqual([42]);
    expect(await res.json()).toEqual({
      configured: true,
      provider: "openrouter",
      model: "test-model",
      seasonModel: "test-model",
      dailyModel: "test-model",
    });
  });

  it("reports an unconfigured account without leaking a stored key", async () => {
    const app = makeApp(() => Promise.resolve(null));

    const res = await app.fetch(settingsRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      configured: false,
      provider: "openrouter",
      model: null,
      seasonModel: null,
      dailyModel: null,
    });
  });
});

describe("PUT /llm/settings", () => {
  function appWithSaved(
    existing: StoredLlmSettings | null,
    saved: StoredLlmSettings[],
  ) {
    return makeApp(() => Promise.resolve(existing), {
      loadCatalog: () =>
        Promise.resolve([
          catalogModel("test-model"),
          catalogModel("new-model"),
        ]),
      saveSettings: (_userId, settings) => {
        saved.push(settings);
        return Promise.resolve();
      },
      provider: fakeProvider,
      credentialsKey: () => keyFromRaw("test-secret"),
    });
  }

  it("rotates only the key and keeps the stored models", async () => {
    const saved: StoredLlmSettings[] = [];
    const app = appWithSaved(stored, saved);

    const res = await app.fetch(putSettingsRequest({ apiKey: "valid-key" }));

    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.model).toBe("test-model");
    expect(saved[0]?.seasonModel).toBe("test-model");
    expect(saved[0]?.dailyModel).toBe("test-model");
    expect(saved[0]?.apiKeyEncrypted).not.toBe("valid-key");
    expect(await res.json()).toEqual({
      configured: true,
      provider: "openrouter",
      model: "test-model",
      seasonModel: "test-model",
      dailyModel: "test-model",
    });
  });

  it("stores the key and both models on the first save", async () => {
    const saved: StoredLlmSettings[] = [];
    const app = appWithSaved(null, saved);

    const res = await app.fetch(
      putSettingsRequest({
        apiKey: "valid-key",
        seasonModel: "test-model",
        dailyModel: "new-model",
      }),
    );

    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.seasonModel).toBe("test-model");
    expect(saved[0]?.dailyModel).toBe("new-model");
  });

  it("does not leak a credentials-key failure to the athlete", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = makeApp(() => Promise.resolve(null), {
        loadCatalog: () => Promise.resolve([catalogModel("test-model")]),
        provider: fakeProvider,
        credentialsKey: () =>
          Promise.reject(
            new Error(
              "LLM_CREDENTIALS_KEY must be set to enable this integration",
            ),
          ),
      });

      const res = await app.fetch(
        putSettingsRequest({
          apiKey: "valid-key",
          seasonModel: "test-model",
          dailyModel: "test-model",
        }),
      );

      expect(res.status).toBe(503);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("service_unavailable");
      expect(body.error.message).toBe(
        "The coach is not available right now. Try again later.",
      );
      expect(JSON.stringify(body)).not.toContain("LLM_CREDENTIALS_KEY");
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[1])).toContain("LLM_CREDENTIALS_KEY");
    } finally {
      log.mockRestore();
    }
  });

  it("rejects a key-only save before any models are stored", async () => {
    const saved: StoredLlmSettings[] = [];
    const app = appWithSaved(null, saved);

    const res = await app.fetch(putSettingsRequest({ apiKey: "valid-key" }));

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Choose both");
    expect(saved).toHaveLength(0);
  });

  it("rejects a model-only save before a key is stored", async () => {
    const saved: StoredLlmSettings[] = [];
    const app = appWithSaved(null, saved);

    const res = await app.fetch(
      putSettingsRequest({
        seasonModel: "test-model",
        dailyModel: "new-model",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("An OpenRouter API key is required");
    expect(saved).toHaveLength(0);
  });

  it("rejects an invalid key", async () => {
    const saved: StoredLlmSettings[] = [];
    const app = appWithSaved(stored, saved);

    const res = await app.fetch(putSettingsRequest({ apiKey: "bad-key" }));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: "llm_key_invalid",
        message: "invalid OpenRouter API key",
      },
    });
    expect(saved).toHaveLength(0);
  });
});

describe("GET /llm/catalog", () => {
  it("returns the graded catalog", async () => {
    const app = makeApp(() => Promise.resolve(stored), {
      loadCatalog: () =>
        Promise.resolve([
          {
            id: "test-model",
            name: "Test Model",
            retired: false,
            discouraged: false,
            ability: "A",
            speed: "B",
            cost: "A+",
            benchmarkScore: 10.8,
            benchmarkTimeMs: 12_000,
            benchmarkCostUsd: 0.002,
            benchmarkedAt: "2026-10-31T15:40:52.865Z",
          },
        ]),
    });

    const res = await app.fetch(
      apiRequest("http://localhost/api/llm/catalog", {
        headers: { authorization: "Bearer anything" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      models: [
        {
          id: "test-model",
          name: "Test Model",
          retired: false,
          discouraged: false,
          ability: "A",
          speed: "B",
          cost: "A+",
          benchmarkScore: 10.8,
          benchmarkTimeMs: 12_000,
          benchmarkCostUsd: 0.002,
          benchmarkedAt: "2026-10-31T15:40:52.865Z",
        },
      ],
    });
  });
});

describe("GET /llm/models", () => {
  function modelsRequest(): Request {
    return apiRequest("http://localhost/api/llm/models", {
      headers: { authorization: "Bearer anything" },
    });
  }

  function appFailingWith(error: Error) {
    return makeApp(() => Promise.resolve(stored), {
      provider: {
        ...fakeProvider,
        listModels: () => Promise.reject(error),
      },
    });
  }

  it("passes the provider's own status through", async () => {
    const app = appFailingWith(
      new LlmProviderError("OpenRouter account has insufficient credits", 402),
    );

    const res = await app.fetch(modelsRequest());

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: {
        code: "payment_required",
        message: "OpenRouter account has insufficient credits",
      },
    });
  });

  it("reports a rate limit as such", async () => {
    const app = appFailingWith(
      new LlmRateLimitError("OpenRouter rate limit reached"),
    );

    const res = await app.fetch(modelsRequest());

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: {
        code: "too_many_requests",
        message: "OpenRouter rate limit reached",
      },
    });
  });

  it("reports a provider failure without a status as unavailable", async () => {
    const app = appFailingWith(
      new LlmProviderError("could not reach OpenRouter for the model list"),
    );

    const res = await app.fetch(modelsRequest());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: {
        code: "service_unavailable",
        message: "could not reach OpenRouter for the model list",
      },
    });
  });

  it("reports an unexpected failure as unavailable", async () => {
    const app = appFailingWith(new Error("boom"));

    const res = await app.fetch(modelsRequest());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: "service_unavailable", message: "Service Unavailable" },
    });
  });
});

describe("GET /llm/costs", () => {
  it("returns the signed-in account's cost buckets", async () => {
    const userIds: number[] = [];
    const costs: LlmCostsResponse = {
      monthly: [
        {
          bucket: "2026-11",
          model: "openai/gpt",
          label: "GPT",
          kind: "season_plan",
          costUsd: 0.42,
          calls: 3,
        },
      ],
      daily: [
        {
          bucket: "2026-11-04",
          model: "openai/gpt",
          label: "GPT",
          kind: "season_plan",
          costUsd: 0.12,
          calls: 1,
        },
      ],
    };
    const app = makeApp(() => Promise.resolve(stored), {
      loadCosts: (userId) => {
        userIds.push(userId);
        return Promise.resolve(costs);
      },
    });

    const res = await app.fetch(
      apiRequest("http://localhost/api/llm/costs", {
        headers: { authorization: "Bearer anything" },
      }),
    );

    expect(res.status).toBe(200);
    expect(userIds).toEqual([42]);
    expect(await res.json()).toEqual(costs);
  });

  it("returns 503 when the cost history cannot be loaded", async () => {
    const app = makeApp(() => Promise.resolve(stored), {
      loadCosts: () => Promise.reject(new Error("database down")),
    });

    const res = await app.fetch(
      apiRequest("http://localhost/api/llm/costs", {
        headers: { authorization: "Bearer anything" },
      }),
    );

    expect(res.status).toBe(503);
  });
});

describe("POST /llm/models/refresh", () => {
  it("starts the background catalog check", async () => {
    let calls = 0;
    const app = makeApp(() => Promise.resolve(stored), {
      refreshCatalog: () => {
        calls += 1;
        return Promise.resolve({
          checked: true,
          added: 0,
          retired: 0,
          rescored: 0,
          reassigned: 0,
          copied: 0,
          removed: 0,
          error: null,
        });
      },
    });

    const res = await app.fetch(
      apiRequest("http://localhost/api/llm/models/refresh", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });
    expect(calls).toBe(1);
  });
});
