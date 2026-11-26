import { describe, expect, it } from "bun:test";
import { authenticatedRequest, makeTestApp } from "../testFixtures/app.js";
import { apiRequest } from "../testFixtures/request.js";

function jsonRequest(path: string, body: unknown): Request {
  return authenticatedRequest(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/measurements", () => {
  it("requires authentication", async () => {
    const app = makeTestApp();
    const response = await app.fetch(
      apiRequest("http://localhost/api/measurements"),
    );
    expect(response.status).toBe(401);
  });

  it("reports the body measures the athlete tracks", async () => {
    const app = makeTestApp({
      loadBodyHistory: () =>
        Promise.resolve({
          weight: [{ date: "2026-11-20", value: 82.4, source: "garmin" }],
          bodyFat: [{ date: "2026-11-21", value: 18.1, source: "user" }],
        }),
    });

    const response = await app.fetch(authenticatedRequest("/api/measurements"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      metrics: ["weight", "bodyFat"],
    });
  });

  it("reports no measures before the athlete has a point for one", async () => {
    const app = makeTestApp();
    const response = await app.fetch(authenticatedRequest("/api/measurements"));

    expect(await response.json()).toEqual({ metrics: [] });
  });

  it("reports a failed read as unavailable", async () => {
    const app = makeTestApp({
      loadBodyHistory: () => Promise.reject(new Error("database down")),
    });
    const response = await app.fetch(authenticatedRequest("/api/measurements"));

    expect(response.status).toBe(503);
  });
});

describe("PUT /api/measurements", () => {
  it("stores the entered values for the date", async () => {
    const saved: unknown[] = [];
    const app = makeTestApp({
      recordUserBodyMetrics: (userId, input) => {
        saved.push({ userId, input });
        return Promise.resolve();
      },
    });

    const response = await app.fetch(
      jsonRequest("/api/measurements", {
        date: "2026-11-26",
        weightKg: 81.2,
        bodyFatPercent: 17.8,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      date: "2026-11-26",
      saved: true,
    });
    expect(saved).toEqual([
      {
        userId: 42,
        input: { date: "2026-11-26", weightKg: 81.2, bodyFatPercent: 17.8 },
      },
    ]);
  });

  it("accepts a single measurement", async () => {
    const app = makeTestApp({
      recordUserBodyMetrics: () => Promise.resolve(),
    });
    const response = await app.fetch(
      jsonRequest("/api/measurements", {
        date: "2026-11-26",
        weightKg: 81.2,
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects a day with no measurement or an impossible value", async () => {
    const app = makeTestApp({
      recordUserBodyMetrics: () => Promise.resolve(),
    });

    expect(
      (
        await app.fetch(
          jsonRequest("/api/measurements", { date: "2026-11-26" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.fetch(
          jsonRequest("/api/measurements", {
            date: "2026-11-26",
            weightKg: 0,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.fetch(
          jsonRequest("/api/measurements", {
            date: "2026-11-26",
            bodyFatPercent: 90,
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("reports a failed write as unavailable", async () => {
    const app = makeTestApp({
      recordUserBodyMetrics: () => Promise.reject(new Error("database down")),
    });
    const response = await app.fetch(
      jsonRequest("/api/measurements", {
        date: "2026-11-26",
        weightKg: 81.2,
      }),
    );

    expect(response.status).toBe(503);
  });
});
