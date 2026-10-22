import { describe, expect, it } from "bun:test";
import type { QuestionAnswerInput } from "@killingit/shared";
import app, { createApp } from "../index.js";
import type {
  QuestionAnswerStore,
  StoredAthleteQuestion,
} from "../questions/answers.js";

const storedQuestion: StoredAthleteQuestion = {
  id: 7,
  versionId: 11,
  prompt: "How did the long run feel?",
  required: true,
  version: 2,
  versionCount: 2,
  createdAt: new Date("2026-10-20T09:00:00.000Z"),
  updatedAt: new Date("2026-10-21T09:00:00.000Z"),
  answer: null,
  skipped: false,
  answeredAt: null,
};

function createTestApp(store: QuestionAnswerStore) {
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore: {
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
    },
    answerStore: store,
  });
}

function authenticatedRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer anything");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe("athlete questions route", () => {
  it("requires a bearer token to list questions", async () => {
    const res = await app.fetch(new Request("http://localhost/api/questions"));

    expect(res.status).toBe(401);
  });

  it("requires a bearer token to submit answers", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/questions/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: [{ questionId: 7, versionId: 11, answer: "Good" }],
        }),
      }),
    );

    expect(res.status).toBe(401);
  });

  it("lists active questions with the user's answers and completion", async () => {
    let requestedUserId = 0;
    const testApp = createTestApp({
      listForUser: (userId) => {
        requestedUserId = userId;
        return Promise.resolve([storedQuestion]);
      },
      saveAnswers: () => Promise.resolve(true),
    });

    const res = await testApp.fetch(authenticatedRequest("/api/questions"));

    expect(res.status).toBe(200);
    expect(requestedUserId).toBe(42);
    const body = (await res.json()) as {
      questions: { prompt: string; answer: string | null }[];
      complete: boolean;
    };
    expect(body.questions[0]?.prompt).toBe("How did the long run feel?");
    expect(body.questions[0]?.answer).toBeNull();
    expect(body.complete).toBe(false);
  });

  it("rejects a submission with a blank answer", async () => {
    let saveCalls = 0;
    const testApp = createTestApp({
      listForUser: () => Promise.resolve([storedQuestion]),
      saveAnswers: () => {
        saveCalls += 1;
        return Promise.resolve(true);
      },
    });

    const res = await testApp.fetch(
      authenticatedRequest("/api/questions/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: [{ questionId: 7, versionId: 11, answer: "   " }],
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(saveCalls).toBe(0);
  });

  it("saves answers for the signed-in user and returns the refreshed set", async () => {
    const saved: { userId: number; answers: readonly QuestionAnswerInput[] } = {
      userId: 0,
      answers: [],
    };
    const answered: StoredAthleteQuestion = {
      ...storedQuestion,
      answer: "Strong until the last 3 km.",
      skipped: false,
      answeredAt: new Date("2026-10-21T10:00:00.000Z"),
    };
    const testApp = createTestApp({
      listForUser: () => Promise.resolve([answered]),
      saveAnswers: (userId, answers) => {
        saved.userId = userId;
        saved.answers = answers;
        return Promise.resolve(true);
      },
    });

    const res = await testApp.fetch(
      authenticatedRequest("/api/questions/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: [
            {
              questionId: 7,
              versionId: 11,
              answer: "  Strong until the last 3 km.  ",
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(saved.userId).toBe(42);
    expect(saved.answers).toEqual([
      {
        questionId: 7,
        versionId: 11,
        answer: "Strong until the last 3 km.",
      },
    ]);
    const body = (await res.json()) as { complete: boolean };
    expect(body.complete).toBe(true);
  });

  it("rejects a submission whose question version is no longer current", async () => {
    const testApp = createTestApp({
      listForUser: () => Promise.resolve([storedQuestion]),
      saveAnswers: () => Promise.resolve(false),
    });

    const res = await testApp.fetch(
      authenticatedRequest("/api/questions/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: [{ questionId: 7, versionId: 10, answer: "Good" }],
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("missing or no longer current");
  });
});
