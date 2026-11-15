import { describe, expect, it } from "bun:test";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
} from "../../testFixtures/app.js";
import { expectValidationFailure } from "../../testFixtures/validation.js";

describe("coaching manual activities", () => {
  it("saves a manual activity, replies, and keeps today's session when dated today", async () => {
    const savedDetails: { value: string | null } = { value: null };
    let keepToday: boolean | undefined;
    const repliedTo: { target: number | null } = { target: null };

    const app = makeApp({
      saveManualActivity: (_userId, activity) => {
        savedDetails.value = activity.details;
        return Promise.resolve(7);
      },
      replyToCoachingInput: (_deps, options) => {
        repliedTo.target =
          options.request.kind === "manual_activity"
            ? options.request.manualActivityId
            : null;
        return Promise.resolve({
          kind: "manual_activity",
          target: "7",
          text: "Noted; I will count the swim as today's session.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
          planChangeNeeded: true,
        });
      },
      triggerPlanGeneration: (_deps, options) => {
        keepToday = options.keepToday;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          startDate: "2026-10-21",
          details: "Pool swim",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(savedDetails.value).toBe("Pool swim");
    expect(repliedTo.target).toBe(7);
    expect(keepToday).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toContain("swim");
  });

  it("estimates TSS for a manual activity from its details", async () => {
    const saved: { tss: number | null | undefined } = { tss: undefined };
    const app = makeApp({
      saveManualActivity: (_userId, activity) => {
        saved.tss = activity.estimatedTss;
        return Promise.resolve(7);
      },
      estimateManualTss: (_provider, _credentials, input) =>
        Promise.resolve(input.details.includes("Zwift race") ? 255 : 0),
      replyToCoachingInput: () => Promise.resolve(null),
      triggerPlanGeneration: () => Promise.resolve(true),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          startDate: "2026-10-21",
          details: "I did a 3 hour Zwift race with average HR at 187 bpm",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(saved.tss).toBe(255);
  });

  it("does not bill for a TSS estimate when editing a missing manual activity", async () => {
    let estimates = 0;
    let triggered = false;
    const app = makeApp({
      updateManualActivity: () => Promise.resolve(false),
      estimateManualTss: () => {
        estimates += 1;
        return Promise.resolve(120);
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual/7", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          startDate: "2026-10-20",
          details: "An easy hour on the bike",
        }),
      }),
    );

    expect(res.status).toBe(404);
    expect(estimates).toBe(0);
    expect(triggered).toBe(false);
  });

  it("re-estimates an edited manual activity once it is known to exist", async () => {
    const clearedEstimates: Array<number | null | undefined> = [];
    const storedEstimates: number[] = [];
    const repliedTo: { target: number | null } = { target: null };
    const app = makeApp({
      updateManualActivity: (_userId, activityId, activity) => {
        expect(activityId).toBe(7);
        clearedEstimates.push(activity.estimatedTss);
        return Promise.resolve(true);
      },
      updateManualActivityTss: (_userId, activityId, estimatedTss) => {
        expect(activityId).toBe(7);
        storedEstimates.push(estimatedTss);
        return Promise.resolve();
      },
      estimateManualTss: () => Promise.resolve(96),
      replyToCoachingInput: (_deps, options) => {
        repliedTo.target =
          options.request.kind === "manual_activity"
            ? options.request.manualActivityId
            : null;
        return Promise.resolve(null);
      },
      triggerPlanGeneration: () => Promise.resolve(true),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual/7", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          startDate: "2026-10-20",
          details: "A hard hour on the bike",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(clearedEstimates).toEqual([null]);
    expect(storedEstimates).toEqual([96]);
    expect(repliedTo.target).toBe(7);
  });

  it("rejects a manual activity without details", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          startDate: "2026-10-20",
          details: "",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns saved manual activities with their coach replies", async () => {
    const app = makeApp({
      loadManualActivities: () =>
        Promise.resolve([
          { id: 7, startDate: "2026-10-21", details: "Pool swim" },
        ]),
      loadManualActivityReplies: () =>
        Promise.resolve(
          new Map([
            [
              7,
              {
                kind: "manual_activity" as const,
                target: "7",
                text: "Nice session.",
                model: "test-model",
                generatedAt: new Date("2026-10-21T12:00:00Z"),
                planChangeNeeded: true,
              },
            ],
          ]),
        ),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      manualActivities: Array<{ coachReply: { text: string } | null }>;
    };
    expect(body.manualActivities[0]?.coachReply?.text).toBe("Nice session.");
  });

  it("deletes a manual activity and triggers a plan revision", async () => {
    const deleted: { userId: number | null; id: number | null } = {
      userId: null,
      id: null,
    };
    let triggered = false;

    const app = makeApp({
      deleteManualActivity: (userId, activityId) => {
        deleted.userId = userId;
        deleted.id = activityId;
        return Promise.resolve(true);
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest(
        "/api/coaching/activities/manual/7?today=2026-10-21",
        {
          method: "DELETE",
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(deleted).toEqual({ userId: 42, id: 7 });
    expect(triggered).toBe(true);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Manual activity deleted");
  });

  it("requires a today date when deleting a manual activity", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/manual/7", {
        method: "DELETE",
      }),
    );

    await expectValidationFailure(res);
  });

  it("returns 404 when deleting an unknown manual activity", async () => {
    const app = makeApp({
      deleteManualActivity: () => Promise.resolve(false),
    });

    const res = await app.fetch(
      authenticatedRequest(
        "/api/coaching/activities/manual/7?today=2026-10-21",
        {
          method: "DELETE",
        },
      ),
    );

    expect(res.status).toBe(404);
  });
});
