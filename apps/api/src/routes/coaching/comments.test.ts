import { describe, expect, it } from "bun:test";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
} from "../../testFixtures/app.js";

describe("coaching activity comments", () => {
  it("saves a comment and starts the combined reply-and-plan run", async () => {
    const saved: {
      value: { userId: number; activityId: string; comment: string } | null;
    } = { value: null };
    let keepToday: boolean | undefined;
    let askedForReplies: boolean | undefined;

    const app = makeApp({
      createActivityComment: (userId, input) => {
        saved.value = { userId, ...input };
        return Promise.resolve(true);
      },
      startCoachRun: (_deps, options) => {
        keepToday = options.keepToday;
        askedForReplies = options.reply;
        return Promise.resolve();
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-21",
          comment: "Felt strong on the hills.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(saved.value).toEqual({
      userId: 42,
      activityId: "123",
      comment: "Felt strong on the hills.",
    });
    expect(keepToday).toBe(true);
    expect(askedForReplies).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply).toBeNull();
  });

  it("falls back to the account time zone when the request omits one", async () => {
    const zones: Array<string | undefined> = [];
    const app = makeApp({
      timezone: "Europe/Oslo",
      createActivityComment: () => Promise.resolve(true),
      startCoachRun: (_deps, options) => {
        zones.push(options.timezone);
        return Promise.resolve();
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-21",
          comment: "Felt strong on the hills.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(zones).toEqual(["Europe/Oslo"]);
  });

  it("does not keep today's session for an earlier activity", async () => {
    let keepToday: boolean | undefined;
    const app = makeApp({
      createActivityComment: () => Promise.resolve(true),
      startCoachRun: (_deps, options) => {
        keepToday = options.keepToday;
        return Promise.resolve();
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-19",
          comment: "Felt strong on the hills.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(keepToday).toBe(false);
  });

  it("rejects a comment without an activity date", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          comment: "Felt strong.",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an empty comment", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-21",
          comment: "",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses to add a second comment to the same activity", async () => {
    let triggered = false;
    const app = makeApp({
      createActivityComment: () => Promise.resolve(false),
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-21",
          comment: "A second comment.",
        }),
      }),
    );

    expect(res.status).toBe(409);
    expect(triggered).toBe(false);
  });

  it("edits the existing comment and refreshes replies and the plan", async () => {
    const saved: {
      value: { userId: number; activityId: string; comment: string } | null;
    } = { value: null };
    let started = false;

    const app = makeApp({
      updateActivityComment: (userId, input) => {
        saved.value = { userId, ...input };
        return Promise.resolve(true);
      },
      startCoachRun: () => {
        started = true;
        return Promise.resolve();
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-19",
          comment: "On reflection, the hills felt harder than I said.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(saved.value).toEqual({
      userId: 42,
      activityId: "123",
      comment: "On reflection, the hills felt harder than I said.",
    });
    expect(started).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply).toBeNull();
  });

  it("returns 404 when editing an activity without a comment", async () => {
    let triggered = false;
    const app = makeApp({
      updateActivityComment: () => Promise.resolve(false),
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/comments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          activityDate: "2026-10-21",
          comment: "A comment that does not exist yet.",
        }),
      }),
    );

    expect(res.status).toBe(404);
    expect(triggered).toBe(false);
  });
});

describe("coaching activity review", () => {
  it("marks an activity as reviewed without triggering a plan revision", async () => {
    const reviewed: {
      value: { userId: number; activityId: string } | null;
    } = { value: null };
    let triggered = false;

    const app = makeApp({
      saveActivityReview: (userId, activityId) => {
        reviewed.value = { userId, activityId };
        return Promise.resolve();
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123/reviewed", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(200);
    expect(reviewed.value).toEqual({ userId: 42, activityId: "123" });
    expect(triggered).toBe(false);
  });
});
