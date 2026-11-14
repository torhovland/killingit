import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requireAuth, requireUser } from "../auth/middleware.js";
import type { Activity } from "@killingit/shared";
import type { GarminCredentials } from "../garmin/client.js";
import { GarminAuthError, type SyncTransport } from "../garmin/client.js";
import type { EncryptedCredentials } from "../garmin/store.js";
import type { UserStore } from "../users/store.js";
import { createGarminRoute } from "./garmin.js";
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
  options: { timezone?: string; now?: () => Date } = {},
) {
  const stored = new Map<number, EncryptedCredentials>();
  const plain = new Map<number, GarminCredentials>();
  const synced: GarminCredentials[] = [];
  const supplementDates: string[] = [];
  // The account's stored zone decides the local day the supplement pass uses.
  const accounts: UserStore = {
    ...users,
    ensureUser: async (sub) => ({
      ...(await users.ensureUser(sub)),
      timezone: options.timezone ?? null,
    }),
  };

  const app = new Hono();
  app.use(
    "/garmin/*",
    requireAuth({ verify: (token) => Promise.resolve({ sub: token }) }),
  );
  app.use("/garmin/*", requireUser(accounts));
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
      syncSupplements: (_userId, _credentials, today) => {
        supplementDates.push(today);
        return Promise.resolve();
      },
      now: options.now ?? (() => new Date()),
    }),
  );

  return { app, stored, plain, synced, supplementDates };
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

  it("refreshes the supplementary data for the athlete's local day", async () => {
    const { app, plain, supplementDates } = makeApp(undefined, {
      timezone: "Europe/Oslo",
      now: () => new Date("2026-11-14T23:30:00Z"),
    });
    plain.set(1, { username: "rider-1", password: "secret-1" });

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(200);
    expect(supplementDates).toEqual(["2026-11-15"]);
  });

  it("reads an account without a time zone in UTC", async () => {
    const { app, plain, supplementDates } = makeApp(undefined, {
      now: () => new Date("2026-11-14T23:30:00Z"),
    });
    plain.set(1, { username: "rider-1", password: "secret-1" });

    await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(supplementDates).toEqual(["2026-11-14"]);
  });

  it("does not sync an account without credentials", async () => {
    const { app, plain, synced } = makeApp();
    plain.set(1, { username: "rider-1", password: "secret-1" });

    const res = await app.fetch(request("/garmin/activities", "athlete-2"));

    expect(res.status).toBe(401);
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

    expect(res.status).toBe(401);
    expect(stored.size).toBe(0);
  });
});
