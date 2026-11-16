import { describe, expect, it } from "bun:test";
import type { CoachQuestion } from "@killingit/shared";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
} from "../../testFixtures/app.js";

const pendingCoachQuestion: CoachQuestion = {
  id: 7,
  question: "How many hours can you train on weekdays?",
  answer: null,
  coachReply: null,
  createdAt: "2026-10-20T09:00:00.000Z",
  answeredAt: null,
};

describe("coach questions", () => {
  it("returns the pending question and the answered history", async () => {
    const app = makeApp({
      loadPendingCoachQuestion: () => Promise.resolve(pendingCoachQuestion),
      loadAnsweredCoachQuestions: () =>
        Promise.resolve([
          {
            ...pendingCoachQuestion,
            id: 6,
            question: "Which day is your long ride?",
            answer: "Saturday.",
            answeredAt: "2026-10-19T10:00:00.000Z",
            coachReply: {
              text: "Saturday works well.",
              model: "test-model",
              generatedAt: "2026-10-19T10:00:00.000Z",
            },
          },
        ]),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/coach-questions"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: CoachQuestion;
      answered: CoachQuestion[];
    };
    expect(body.pending.question).toBe(
      "How many hours can you train on weekdays?",
    );
    expect(body.answered[0]?.answer).toBe("Saturday.");
    expect(body.answered[0]?.coachReply?.text).toBe("Saturday works well.");
  });

  it("saves an answer, generates a reply and starts a coach run", async () => {
    const saved: {
      value: { answer: string; reply: string | null } | null;
    } = { value: null };
    const runs: Array<{ reply: boolean | undefined; today: string }> = [];
    const app = makeApp({
      loadCoachQuestion: () => Promise.resolve(pendingCoachQuestion),
      replyToCoachQuestion: () =>
        Promise.resolve({
          text: "Six hours is enough for a steady base.",
          model: "test-model",
          generatedAt: new Date("2026-10-20T10:00:00Z"),
          planChangeNeeded: true,
        }),
      answerCoachQuestion: (input) => {
        saved.value = { answer: input.answer, reply: input.reply };
        return Promise.resolve({
          ...pendingCoachQuestion,
          answer: input.answer,
          coachReply: {
            text: input.reply ?? "",
            model: input.replyModel ?? "test-model",
            generatedAt: "2026-10-20T10:00:00.000Z",
          },
          answeredAt: "2026-10-20T10:00:00.000Z",
        });
      },
      startCoachRun: (_deps, options) => {
        runs.push({ reply: options.reply, today: options.today });
        return Promise.resolve();
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/coach-questions/7/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-20",
          answer: "About six hours.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(saved.value).toEqual({
      answer: "About six hours.",
      reply: "Six hours is enough for a steady base.",
    });
    expect(runs).toEqual([{ reply: true, today: "2026-10-20" }]);
  });

  it("falls back to the account time zone when the request omits one", async () => {
    const zones: Array<string | undefined> = [];
    const app = makeApp({
      timezone: "Europe/Oslo",
      loadCoachQuestion: () => Promise.resolve(pendingCoachQuestion),
      replyToCoachQuestion: () => Promise.resolve(null),
      answerCoachQuestion: (input) =>
        Promise.resolve({
          ...pendingCoachQuestion,
          answer: input.answer,
          answeredAt: "2026-10-20T10:00:00.000Z",
        }),
      startCoachRun: (_deps, options) => {
        zones.push(options.timezone);
        return Promise.resolve();
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/coach-questions/7/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-20",
          answer: "About six hours.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(zones).toEqual(["Europe/Oslo"]);
  });
});

describe("coaching by-the-way questions", () => {
  it("returns the coach's answer without saving or revising the plan", async () => {
    const received: {
      value: { userId: number; question: string } | null;
    } = { value: null };
    let triggered = false;

    const app = makeApp({
      answerCoachingQuestion: (_deps, options) => {
        received.value = {
          userId: options.userId,
          question: options.question,
        };
        return Promise.resolve({
          text: "Run it on Saturday.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
          planChangeNeeded: false,
        });
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          question: "Should I run on Saturday or Sunday?",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(received.value).toEqual({
      userId: 42,
      question: "Should I run on Saturday or Sunday?",
    });
    expect(triggered).toBe(false);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toBe("Run it on Saturday.");
  });

  it("rejects an empty question", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21", question: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
