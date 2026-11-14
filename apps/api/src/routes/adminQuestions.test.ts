import { describe, expect, it } from "bun:test";
import type { StoredQuestion } from "../questions/store.js";
import type { QuestionSetStore } from "../questions/adminStore.js";
import type { StoredUser, UserStore } from "../users/store.js";
import { createApp } from "../index.js";
import { apiRequest } from "../testFixtures/request.js";

const app = createApp();

const admin: StoredUser = {
  id: 1,
  sub: "auth|admin",
  role: "admin",
  timezone: null,
  location: null,
  dietAdvice: false,
  createdAt: new Date(0),
};

/** A user store with the admin signed in, so the admin guard passes. */
function adminUserStore(role: StoredUser["role"]): UserStore {
  return {
    ensureUser: (sub) => Promise.resolve({ ...admin, sub, role }),
    getById: () => Promise.resolve({ ...admin, role }),
    deleteUser: () => Promise.resolve(),
    updateSettings: (sub, update) =>
      Promise.resolve({
        ...admin,
        sub,
        role,
        timezone: update.timezone ?? null,
        location: update.location ?? null,
      }),
  };
}

function storedQuestion(
  overrides: Partial<StoredQuestion> = {},
): StoredQuestion {
  return {
    id: 1,
    versionId: 11,
    prompt: "How did the race go?",
    required: true,
    version: 2,
    versionCount: 3,
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
    updatedAt: new Date("2026-11-02T10:00:00.000Z"),
    ...overrides,
  };
}

/** An admin app whose question set is the injected store, not Postgres. */
function wiredApp(questionSet: QuestionSetStore) {
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: admin.sub }) },
    userStore: adminUserStore("admin"),
    questionSetStore: questionSet,
  });
}

function adminRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer anything");
  return apiRequest(`http://localhost/api/admin/questions${path}`, {
    ...init,
    headers,
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
      userStore: adminUserStore("member"),
    });

    const res = await nonAdminApp.fetch(
      apiRequest("http://localhost/api/admin/questions", {
        headers: { authorization: "Bearer anything" },
      }),
    );

    expect(res.status).toBe(403);
  });
});

describe("admin questions dependency wiring", () => {
  function questionSet(
    overrides: Partial<QuestionSetStore> = {},
  ): QuestionSetStore {
    return {
      listActiveQuestions: () => Promise.resolve([storedQuestion()]),
      createQuestion: (input) =>
        Promise.resolve(
          storedQuestion({ id: 2, versionId: 12, prompt: input.prompt }),
        ),
      addQuestionVersion: () => Promise.resolve(storedQuestion()),
      reorderQuestions: () => Promise.resolve(true),
      archiveQuestion: () => Promise.resolve(true),
      ...overrides,
    };
  }

  it("lists the question set from the injected store", async () => {
    const res = await wiredApp(questionSet()).fetch(adminRequest(""));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      questions: [
        {
          id: 1,
          versionId: 11,
          prompt: "How did the race go?",
          required: true,
          version: 2,
          versionCount: 3,
          createdAt: "2026-11-01T10:00:00.000Z",
          updatedAt: "2026-11-02T10:00:00.000Z",
        },
      ],
    });
  });

  it("creates a question through the injected store", async () => {
    const prompts: string[] = [];
    const app = wiredApp(
      questionSet({
        createQuestion: (input) => {
          prompts.push(input.prompt);
          return Promise.resolve(
            storedQuestion({ id: 2, versionId: 12, prompt: input.prompt }),
          );
        },
      }),
    );

    const res = await app.fetch(
      adminRequest("", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "How is the knee?" }),
      }),
    );

    expect(res.status).toBe(201);
    expect(prompts).toEqual(["How is the knee?"]);
    expect(await res.json()).toMatchObject({ prompt: "How is the knee?" });
  });

  it("rejects an order the injected store refuses", async () => {
    const app = wiredApp(
      questionSet({ reorderQuestions: () => Promise.resolve(false) }),
    );

    const res = await app.fetch(
      adminRequest("/order", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [1, 2] }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("must include every active question");
  });
});
