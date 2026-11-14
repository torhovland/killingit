import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requireAuth, requireUser } from "../auth/middleware.js";
import type { Activity } from "@killingit/shared";
import type { GarminCredentials } from "../garmin/client.js";
import {
  GarminAuthError,
  GarminSidecarError,
  type SyncTransport,
} from "../garmin/client.js";
import type { EncryptedCredentials } from "../garmin/store.js";
import type { UserStore } from "../users/store.js";
import { createGarminRoute, type GarminRouteDependencies } from "./garmin.js";
import { apiRequest } from "../testFixtures/request.js";

const ORIGINAL_KEY = process.env.GARMIN_CREDENTIALS_KEY;

beforeAll(() => {
  process.env.GARMIN_CREDENTIALS_KEY = "garmin-route-test-key";
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.GARMIN_CREDENTIALS_KEY;
  } else {
    process.env.GARMIN_CREDENTIALS_KEY = ORIGINAL_KEY;
  }
});

/** Two signed-in accounts, keyed by the auth subjects used in requests. */
const users: UserStore = {
  ensureUser: (sub) =>
    Promise.resolve({
      id: sub === "athlete-1" ? 1 : 2,
      sub,
      role: "member",
      timezone: null,
      location: null,
      dietAdvice: false,
      createdAt: new Date(0),
    }),
  getById: (id) =>
    Promise.resolve({
      id,
      sub: id === 1 ? "athlete-1" : "athlete-2",
      role: "member",
      timezone: null,
      location: null,
      dietAdvice: false,
      createdAt: new Date(0),
    }),
  deleteUser: () => Promise.resolve(),
  updateSettings: (sub, settings) =>
    Promise.resolve({
      id: sub === "athlete-1" ? 1 : 2,
      sub,
      role: "member",
      timezone: settings.timezone ?? null,
      location: settings.location ?? null,
      dietAdvice: false,
      createdAt: new Date(0),
    }),
};

function makeApp(
  authenticate?: () => Promise<boolean>,
  overrides: Pick<GarminRouteDependencies, "syncMetrics" | "syncDaily"> = {},
) {
  const stored = new Map<number, EncryptedCredentials>();
  const plain = new Map<number, GarminCredentials>();
  const synced: GarminCredentials[] = [];

  const app = new Hono();
  app.use(
    "/garmin/*",
    requireAuth({ verify: (token) => Promise.resolve({ sub: token }) }),
  );
  app.use("/garmin/*", requireUser(users));
  app.route(
    "/garmin",
    createGarminRoute({
      loadStoredCredentials: (userId) =>
        Promise.resolve(stored.get(userId) ?? null),
      saveStoredCredentials: (userId, credentials) => {
        stored.set(userId, credentials);
        return Promise.resolve();
      },
      loadDecryptedCredentials: (userId) =>
        Promise.resolve(plain.get(userId) ?? null),
      authenticate: authenticate ?? (() => Promise.resolve(true)),
      syncActivities: ((credentials) => {
        synced.push(credentials);
        return Promise.resolve([] as Activity[]);
      }) satisfies SyncTransport,
      syncMetrics:
        overrides.syncMetrics ??
        (() => Promise.resolve({ metrics: [], ftp: [] })),
      saveMetrics: () => Promise.resolve(),
      saveFtp: () => Promise.resolve(),
      syncDaily:
        overrides.syncDaily ??
        (() =>
          Promise.resolve({
            fetched: [],
            rateLimited: false,
            failedDate: null,
          })),
    }),
  );

  return { app, stored, plain, synced };
}

function request(path: string, subject: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${subject}`);
  return apiRequest(`http://localhost${path}`, { ...init, headers });
}

describe("per-user Garmin credentials", () => {
  it("stores credentials for the signed-in account only", async () => {
    const { app, stored } = makeApp();

    const res = await app.fetch(
      request("/garmin/credentials", "athlete-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "rider-1", password: "secret" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true });
    expect(stored.get(1)).toBeDefined();
    expect(stored.get(2)).toBeUndefined();
  });

  it("reports connection status per account", async () => {
    const { app, stored } = makeApp();
    stored.set(1, {
      usernameEncrypted: "encrypted-username",
      passwordEncrypted: "encrypted-password",
    });

    const own = await app.fetch(request("/garmin/status", "athlete-1"));
    const other = await app.fetch(request("/garmin/status", "athlete-2"));

    expect(await own.json()).toEqual({ connected: true });
    expect(await other.json()).toEqual({ connected: false });
  });

  it("syncs with the signed-in account's credentials, not another's", async () => {
    const { app, plain, synced } = makeApp();
    plain.set(1, { username: "rider-1", password: "secret-1" });
    plain.set(2, { username: "rider-2", password: "secret-2" });

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activities: [] });
    expect(synced).toEqual([{ username: "rider-1", password: "secret-1" }]);
  });

  it("still syncs daily health when body metrics fail", async () => {
    const dailyUserIds: number[] = [];
    const { app, plain } = makeApp(undefined, {
      syncMetrics: () => Promise.reject(new Error("body composition outage")),
      syncDaily: ({ userId }) => {
        dailyUserIds.push(userId);
        return Promise.resolve({
          fetched: [],
          rateLimited: false,
          failedDate: null,
        });
      },
    });
    plain.set(1, { username: "rider-1", password: "secret-1" });

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activities: [] });
    expect(dailyUserIds).toEqual([1]);
  });

  it("returns the activities when daily health fails", async () => {
    const { app, plain } = makeApp(undefined, {
      syncDaily: () => Promise.reject(new Error("daily outage")),
    });
    plain.set(1, { username: "rider-1", password: "secret-1" });

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activities: [] });
  });

  it("does not sync an account without credentials", async () => {
    const { app, plain, synced } = makeApp();
    plain.set(1, { username: "rider-1", password: "secret-1" });

    const res = await app.fetch(request("/garmin/activities", "athlete-2"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "garmin_auth_failed",
        message: "Not connected to Garmin",
      },
    });
    expect(synced).toEqual([]);
  });

  it("does not store credentials Garmin rejects", async () => {
    const { app, stored } = makeApp(() =>
      Promise.reject(new GarminAuthError("invalid Garmin credentials")),
    );

    const res = await app.fetch(
      request("/garmin/credentials", "athlete-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "rider-1", password: "wrong" }),
      }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "garmin_auth_failed",
        message: "invalid Garmin credentials",
      },
    });
    expect(stored.size).toBe(0);
  });

  it("translates a sidecar 401 to a credential failure", async () => {
    const { app, stored } = makeApp(() =>
      Promise.reject(new GarminSidecarError("Garmin session rejected", 401)),
    );

    const res = await app.fetch(
      request("/garmin/credentials", "athlete-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "rider-1", password: "secret" }),
      }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "garmin_auth_failed",
        message: "Garmin session rejected",
      },
    });
    expect(stored.size).toBe(0);
  });

  it("passes a sidecar status through when Garmin asks for MFA", async () => {
    const { app, stored } = makeApp(() =>
      Promise.reject(new GarminSidecarError("MFA is required", 403)),
    );

    const res = await app.fetch(
      request("/garmin/credentials", "athlete-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "rider-1", password: "secret" }),
      }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "MFA is required" },
    });
    expect(stored.size).toBe(0);
  });
});
