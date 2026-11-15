import { describe, expect, it } from "bun:test";
import type {
  PeriodReviewWithReply,
  StoredPeriodReview,
} from "../../plans/periodReviews.js";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
} from "../../testFixtures/app.js";

function makePeriodReview(
  overrides: Partial<StoredPeriodReview> = {},
): PeriodReviewWithReply {
  return {
    review: {
      kind: "week",
      startDate: "2026-10-13",
      endDate: "2026-10-19",
      title: "Week starting 2026-10-13",
      summary: "A consistent week of easy aerobic work.",
      model: "test-model",
      promptVersion: 1,
      comment: null,
      reviewed: false,
      generatedAt: new Date("2026-10-20T09:00:00Z"),
      updatedAt: new Date("2026-10-20T09:00:00Z"),
      ...overrides,
    },
    reply: null,
  };
}

describe("coaching week and block reviews", () => {
  it("lists stored reviews with the coach reply", async () => {
    const entry = makePeriodReview();
    entry.reply = {
      kind: "week_review",
      target: "2026-10-13",
      text: "Good consistency; keep the next week easy.",
      model: "test-model",
      generatedAt: new Date("2026-10-20T10:00:00Z"),
      planChangeNeeded: true,
    };
    const app = makeApp({
      loadPeriodReviews: () => Promise.resolve([entry]),
    });

    const res = await app.fetch(authenticatedRequest("/api/coaching/reviews"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reviews: Array<{
        kind: string;
        comment: string | null;
        coachReply: { text: string } | null;
      }>;
    };
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]?.kind).toBe("week");
    expect(body.reviews[0]?.comment).toBeNull();
    expect(body.reviews[0]?.coachReply?.text).toBe(
      "Good consistency; keep the next week easy.",
    );
  });

  it("includes the week's note and the coach's reply to it", async () => {
    const entry = makePeriodReview();
    entry.weeklyNote = {
      note: "I will be travelling this week.",
      reply: {
        kind: "weekly_note",
        target: "2026-10-13",
        text: "I kept the week light while you travel.",
        model: "test-model",
        generatedAt: new Date("2026-10-14T10:00:00Z"),
        planChangeNeeded: true,
      },
    };
    const app = makeApp({
      loadPeriodReviews: () => Promise.resolve([entry]),
    });

    const res = await app.fetch(authenticatedRequest("/api/coaching/reviews"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reviews: Array<{
        weeklyNote: {
          note: string;
          coachReply: { text: string } | null;
        } | null;
      }>;
    };
    expect(body.reviews[0]?.weeklyNote?.note).toBe(
      "I will be travelling this week.",
    );
    expect(body.reviews[0]?.weeklyNote?.coachReply?.text).toBe(
      "I kept the week light while you travel.",
    );
  });

  it("saves a review comment, replies, and triggers a plan refresh", async () => {
    const saved = { value: false };
    const triggered = { value: false };
    const replied = { comment: null as string | null };
    const app = makeApp({
      loadPeriodReview: () => Promise.resolve(makePeriodReview().review),
      createPeriodReviewComment: (_userId, kind, startDate, comment) => {
        saved.value = kind === "week" && startDate === "2026-10-13";
        replied.comment = comment;
        return Promise.resolve(true);
      },
      replyToCoachingInput: (_deps, options) => {
        if (options.request.kind === "week_review") {
          replied.comment = options.request.comment;
        }
        return Promise.resolve({
          kind: "week_review",
          target: "2026-10-13",
          text: "Nice week; recover before the next build.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T09:00:00Z"),
          planChangeNeeded: true,
        });
      },
      triggerPlanGeneration: () => {
        triggered.value = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/reviews/week/2026-10-13/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          comment: "I felt strong all week.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(saved.value).toBe(true);
    expect(replied.comment).toBe("I felt strong all week.");
    expect(triggered.value).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toBe("Nice week; recover before the next build.");
  });

  it("edits an existing comment and rejects a second add", async () => {
    let comment: string | null = "Old comment";
    const app = makeApp({
      loadPeriodReview: () =>
        Promise.resolve(makePeriodReview({ comment }).review),
      createPeriodReviewComment: () => Promise.resolve(false),
      updatePeriodReviewComment: (_userId, _kind, _startDate, next) => {
        comment = next;
        return Promise.resolve(true);
      },
      replyToCoachingInput: () => Promise.resolve(null),
      triggerPlanGeneration: () => Promise.resolve(true),
    });

    const created = await app.fetch(
      authenticatedRequest("/api/coaching/reviews/week/2026-10-13/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          comment: "Second comment",
        }),
      }),
    );
    expect(created.status).toBe(409);

    const edited = await app.fetch(
      authenticatedRequest("/api/coaching/reviews/week/2026-10-13/comments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          comment: "Updated comment",
        }),
      }),
    );
    expect(edited.status).toBe(200);
    expect(comment).toBe("Updated comment");
  });

  it("marks a review as acknowledged", async () => {
    let reviewed = false;
    const app = makeApp({
      markPeriodReviewReviewed: (_userId, kind, startDate) => {
        reviewed = kind === "block" && startDate === "2026-09-01";
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/reviews/block/2026-09-01/reviewed", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(200);
    expect(reviewed).toBe(true);
  });
});
