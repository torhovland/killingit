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
      createdAt: new Date(0),
    }),
  updateTimezone: (sub, timezone) =>
    Promise.resolve({
      id: 42,
      sub,
      role: "member",
      timezone,
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
) {
  const app = new Hono();
  app.use(
    "*",
    requireAuth({ verify: () => Promise.resolve({ sub: "athlete-1" }) }),
  );
  app.route("/llm", createLlmRoute({ users: userStore, loadSettings }));
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
    });
  });
});
