import { describe, it } from "bun:test";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
} from "../../testFixtures/app.js";
import { expectValidationFailure } from "../../testFixtures/validation.js";

describe("coaching path params", () => {
  const manualBody = JSON.stringify({
    today: "2026-10-21",
    startDate: "2026-10-20",
    details: "An easy hour on the bike",
  });

  it("rejects an invalid manual activity id when editing", async () => {
    const app = makeApp({
      updateManualActivity: () => Promise.resolve(true),
    });
    for (const id of ["0", "-1", "1.5", "1e12", "abc"]) {
      const res = await app.fetch(
        authenticatedRequest(`/api/coaching/activities/manual/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: manualBody,
        }),
      );
      await expectValidationFailure(res);
    }
  });

  it("rejects an invalid manual activity id when deleting", async () => {
    const app = makeApp({
      deleteManualActivity: () => Promise.resolve(true),
    });
    for (const id of ["0", "-1", "1.5", "1e12", "abc"]) {
      const res = await app.fetch(
        authenticatedRequest(
          `/api/coaching/activities/manual/${id}?today=2026-10-21`,
          { method: "DELETE" },
        ),
      );
      await expectValidationFailure(res);
    }
  });

  it("rejects an invalid coach question id when answering", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/coach-questions/abc/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21", answer: "Six hours." }),
      }),
    );
    await expectValidationFailure(res);
  });

  it("rejects an unknown review kind", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/reviews/month/2026-10-13/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-10-21", comment: "A good month." }),
      }),
    );
    await expectValidationFailure(res);
  });

  it("rejects a malformed review start date", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/reviews/week/not-a-date/reviewed", {
        method: "POST",
      }),
    );
    await expectValidationFailure(res);
  });

  it("rejects an activity id that is not a bounded identifier", async () => {
    const app = makeApp({
      createActivityComment: () => Promise.resolve(true),
    });
    const res = await app.fetch(
      authenticatedRequest(
        `/api/coaching/activities/${"9".repeat(120)}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            today: "2026-10-21",
            activityDate: "2026-10-19",
            comment: "Felt strong.",
          }),
        },
      ),
    );
    await expectValidationFailure(res);
  });
});
