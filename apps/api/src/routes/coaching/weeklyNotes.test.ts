import { describe, expect, it } from "bun:test";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
} from "../../testFixtures/app.js";
import { expectValidationFailure } from "../../testFixtures/validation.js";

describe("coaching weekly notes", () => {
  it("saves a weekly note, replies, and triggers plan generation", async () => {
    const savedNote: { value: string | null } = { value: null };
    let triggered = false;

    const app = makeApp({
      saveWeeklyNote: (_userId, _today, note) => {
        savedNote.value = note;
        return Promise.resolve();
      },
      replyToCoachingInput: () =>
        Promise.resolve({
          kind: "weekly_note",
          target: "2026-10-19",
          text: "Understood; Thursday will be a rest day.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
          planChangeNeeded: true,
        }),
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/weekly/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today: "2026-10-21",
          note: "I cannot train on Thursday this week.",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(savedNote.value).toBe("I cannot train on Thursday this week.");
    expect(triggered).toBe(true);
    const body = (await res.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toContain("Thursday");
  });

  it("returns the saved note with its coach reply", async () => {
    const app = makeApp({
      loadWeeklyNote: () => Promise.resolve("No training on Thursday."),
      loadWeeklyNoteReply: () =>
        Promise.resolve({
          kind: "weekly_note",
          target: "2026-10-19",
          text: "Understood; Thursday will be a rest day.",
          model: "test-model",
          generatedAt: new Date("2026-10-21T12:00:00Z"),
          planChangeNeeded: true,
        }),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/weekly/notes?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      note: string | null;
      reply: { text: string } | null;
    };
    expect(body.note).toBe("No training on Thursday.");
    expect(body.reply?.text).toContain("rest day");
  });

  it("requires a today date to show the current week's note", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/weekly/notes"),
    );

    await expectValidationFailure(res);
  });

  it("rejects an empty weekly note", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/weekly/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21", note: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
