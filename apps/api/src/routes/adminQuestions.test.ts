import { describe, expect, it } from "bun:test";
import type { QuestionInput, Question } from "@killingit/shared";
import type { AppDependencies } from "../dependencies.js";
import { createApp } from "../index.js";
import type { StoredQuestion } from "../questions/store.js";
import type { UserStore } from "../users/store.js";
import { apiRequest } from "../testFixtures/request.js";

const app = createApp();

/** One signed-in account per role, keyed by the auth subject. */
function userStore(role: "admin" | "member"): UserStore {
  const account = {
    id: role === "admin" ? 1 : 2,
    sub: role === "admin" ? "auth|admin" : "athlete-2",
    role,
    timezone: null,
    location: null,
    dietAdvice: false,
    createdAt: new Date(0),
  };

  return {
    ensureUser: (sub) => Promise.resolve({ ...account, sub }),
    getById: (id) => Promise.resolve({ ...account, id }),
    deleteUser: () => Promise.resolve(),
    updateSettings: (sub, update) =>
      Promise.resolve({
        ...account,
        sub,
        timezone: update.timezone ?? null,
        location: update.location ?? null,
      }),
  };
}

const storedQuestion: StoredQuestion = {
  id: 7,
  versionId: 9,
  prompt: "How did the long ride feel?",
  required: true,
  version: 2,
  versionCount: 2,
  createdAt: new Date("2026-10-01T09:00:00.000Z"),
  updatedAt: new Date("2026-10-02T09:00:00.000Z"),
};

const question: Question = {
  id: storedQuestion.id,
  versionId: storedQuestion.versionId,
  prompt: storedQuestion.prompt,
  required: storedQuestion.required,
  version: storedQuestion.version,
  versionCount: storedQuestion.versionCount,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-02T09:00:00.000Z",
};

function adminApp(adminQuestions: AppDependencies["adminQuestions"]) {
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "auth|admin" }) },
    userStore: userStore("admin"),
    adminQuestions,
  });
}

function adminRequest(path: string, init?: RequestInit): Request {
  return apiRequest(`http://localhost${path}`, {
    ...init,
    headers: {
      authorization: "Bearer anything",
      ...init?.headers,
    },
  });
}

describe("admin questions route", () => {
  it("requires a bearer token to list questions", async () => {
    const res = await app.fetch(
      apiRequest("http://localhost/api/admin/questions"),
    );

    expect(res.status).toBe(401);
  });

  it("requires a bearer token to create a question", async () => {
    const res = await app.fetch(
      apiRequest("http://localhost/api/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "How did it go?" }),
      }),
    );

    expect(res.status).toBe(401);
  });

  it("requires a bearer token to reorder questions", async () => {
    const res = await app.fetch(
      apiRequest("http://localhost/api/admin/questions/order", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [1, 2] }),
      }),
    );

    expect(res.status).toBe(401);
  });

  it("rejects a signed-in non-admin with 403", async () => {
    const nonAdminApp = createApp({
      authProvider: { verify: () => Promise.resolve({ sub: "athlete-2" }) },
      userStore: userStore("member"),
    });

    const res = await nonAdminApp.fetch(adminRequest("/api/admin/questions"));

    expect(res.status).toBe(403);
  });
});

describe("admin questions route dependency wiring", () => {
  it("lists the questions from the store injected through createApp", async () => {
    let listCalls = 0;
    const routed = adminApp({
      listActiveQuestions: () => {
        listCalls += 1;
        return Promise.resolve([storedQuestion]);
      },
    });

    const res = await routed.fetch(adminRequest("/api/admin/questions"));

    expect(res.status).toBe(200);
    expect(listCalls).toBe(1);
    const body = (await res.json()) as { questions: Question[] };
    expect(body.questions[0]?.prompt).toBe(storedQuestion.prompt);
  });

  it("creates a question through the store injected through createApp", async () => {
    const inputs: QuestionInput[] = [];
    const routed = adminApp({
      createQuestion: (input) => {
        inputs.push(input);
        return Promise.resolve(storedQuestion);
      },
    });

    const res = await routed.fetch(
      adminRequest("/api/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: storedQuestion.prompt, required: true }),
      }),
    );

    expect(res.status).toBe(201);
    expect(inputs).toEqual([{ prompt: storedQuestion.prompt, required: true }]);
    expect(await res.json()).toEqual(question);
  });
});
