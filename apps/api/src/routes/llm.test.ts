import { describe, expect, it } from "bun:test";
import type { LlmCatalogModel } from "@killingit/shared";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
import { keyFromRaw } from "../crypto/credentials.js";
import { LlmAuthError, type LlmProvider } from "../llm/openrouter.js";
import type { StoredLlmSettings } from "../llm/store.js";
import type { UserStore } from "../users/store.js";
import { createLlmRoute } from "./llm.js";

const userStore: UserStore = {
  ensureUser: (sub) =>
    Promise.resolve({
      id: 42,
      sub,
      role: "member",
      timezone: null,
      location: null,
      createdAt: new Date(0),
    }),
  getById: (id) =>
    Promise.resolve({
      id,
      sub: "athlete-1",
      role: "member",
      timezone: null,
      location: null,
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
  } = {},
) {
  const app = new Hono();
  app.use(
    "*",
    requireAuth({ verify: () => Promise.resolve({ sub: "athlete-1" }) }),
  );
  app.route(
    "/llm",
    createLlmRoute({ users: userStore, loadSettings, ...extras }),
  );
  return app;
}

function settingsRequest(): Request {
  return new Request("http://localhost/llm/settings", {
    headers: { authorization: "Bearer anything" },
  });
}

function putSettingsRequest(body: unknown): Request {
  return new Request("http://localhost/llm/settings", {
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

    expect(res.status).toBe(401);
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
      new Request("http://localhost/llm/catalog", {
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
      new Request("http://localhost/llm/models/refresh", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });
    expect(calls).toBe(1);
  });
});
