import { describe, expect, it } from "bun:test";
import type { LlmCallDetail, LlmCallSummary } from "@killingit/shared";
import { createApp } from "../index.js";
import type { UserStore, StoredUser } from "../users/store.js";

const admin: StoredUser = {
  id: 1,
  sub: "auth|admin",
  role: "admin",
  timezone: null,
  location: null,
  createdAt: new Date(0),
};

const summary: LlmCallSummary = {
  id: 12,
  createdAt: "2026-10-28T09:00:00.000Z",
  userId: 1,
  userLabel: "auth|admin",
  kind: "season_plan",
  provider: "openrouter",
  model: "openrouter/model",
  durationMs: 1200,
  failed: false,
};

const detail: LlmCallDetail = {
  ...summary,
  messages: [
    { role: "system", content: "You are a coach." },
    { role: "user", content: "Plan my season." },
  ],
  response: "Here is the plan.",
  error: null,
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  metadata: { attempt: 1, temperature: 0.4 },
};

function userStore(user: StoredUser | null): UserStore {
  return {
    ensureUser: (sub) => {
      if (user === null) {
        throw new Error("not used");
      }
      return Promise.resolve({ ...user, sub });
    },
    getById: () => Promise.resolve(user),
    updateSettings: (sub, update) =>
      Promise.resolve({
        ...(user ?? admin),
        sub,
        timezone: update.timezone ?? null,
        location: update.location ?? null,
      }),
  };
}

function app(options: {
  role?: "admin" | "member";
  listCalls?: (limit: number, offset: number) => Promise<LlmCallSummary[]>;
  getCall?: (id: number) => Promise<LlmCallDetail | null>;
}) {
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "auth|admin" }) },
    userStore: userStore({
      ...admin,
      role: options.role ?? "admin",
    }),
    adminLlmCalls: {
      listCalls: options.listCalls ?? (() => Promise.resolve([summary])),
      getCall: options.getCall ?? (() => Promise.resolve(detail)),
    },
  });
}

function request(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer anything" },
  });
}

describe("admin LLM calls route", () => {
  it("requires a bearer token", async () => {
    const res = await createApp().fetch(
      new Request("http://localhost/api/admin/llm-calls"),
    );

    expect(res.status).toBe(401);
  });

  it("rejects a signed-in non-admin", async () => {
    const res = await app({ role: "member" }).fetch(
      request("/api/admin/llm-calls"),
    );

    expect(res.status).toBe(403);
  });

  it("lists calls with the requested paging", async () => {
    const received: { value?: { limit: number; offset: number } } = {};
    const res = await app({
      listCalls: (limit, offset) => {
        received.value = { limit, offset };
        return Promise.resolve([summary]);
      },
    }).fetch(request("/api/admin/llm-calls?limit=10&offset=5"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { calls: LlmCallSummary[] };
    expect(body.calls).toEqual([summary]);
    expect(received.value).toEqual({ limit: 10, offset: 5 });
  });

  it("returns the full prompt and response for one call", async () => {
    const res = await app({}).fetch(request("/api/admin/llm-calls/12"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(detail);
  });

  it("returns 404 for an unknown call", async () => {
    const res = await app({ getCall: () => Promise.resolve(null) }).fetch(
      request("/api/admin/llm-calls/999"),
    );

    expect(res.status).toBe(404);
  });

  it("rejects a non-numeric id", async () => {
    const res = await app({}).fetch(request("/api/admin/llm-calls/abc"));

    expect(res.status).toBe(400);
  });
});
