import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
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

function makeApp(
  loadSettings: (userId: number) => Promise<StoredLlmSettings | null>,
  extras: {
    loadCatalog?: () => Promise<
      Array<{
        id: string;
        name: string;
        retired: boolean;
        discouraged: boolean;
        ability: "A+" | "A" | "B" | "C" | "D" | "E" | "F" | "?";
        speed: "A+" | "A" | "B" | "C" | "D" | "E" | "F" | "?";
        cost: "A+" | "A" | "B" | "C" | "D" | "E" | "F" | "?";
        benchmarkScore: number | null;
        benchmarkTimeMs: number | null;
        benchmarkCostUsd: number | null;
      }>
    >;
    refreshCatalog?: () => Promise<{
      checked: boolean;
      added: number;
      retired: number;
      rescored: number;
      reassigned: number;
      copied: number;
      error: string | null;
    }>;
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
