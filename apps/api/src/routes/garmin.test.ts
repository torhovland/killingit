import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Activity, AnalyzedActivity } from "@killingit/shared";
import { credentialsKeyFromEnv, decrypt } from "../crypto/credentials.js";
import type { GarminCredentials } from "../garmin/client.js";
import { GarminSidecarError, type SyncTransport } from "../garmin/client.js";
import type { EncryptedCredentials } from "../garmin/store.js";
import type { AppDependencies } from "../dependencies.js";
import { createApp } from "../index.js";
import type { UserStore } from "../users/store.js";
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
  options: {
    timezone?: string;
    now?: () => Date;
    syncActivities?: SyncTransport;
    /** The supplementary work; the route starts it in the background. */
    syncSupplements?: () => Promise<void>;
    /** The stored feed the route reads for the ids and previews. */
    loadStoredFeed?: () => Promise<{
      model: null;
      activities: AnalyzedActivity[];
    }>;
    /** The decrypting credential read, so a test can fail it. */
    loadDecrypted?: (userId: number) => Promise<GarminCredentials | null>;
  } = {},
) {
  const stored = new Map<number, EncryptedCredentials>();
  const plain = new Map<number, GarminCredentials>();
  const synced: GarminCredentials[] = [];
  const knownIds: (readonly number[])[] = [];
  const supplementDates: string[] = [];
  // The account's stored zone decides the local day the supplement pass uses.
  const accounts: UserStore = {
    ...users,
    ensureUser: async (sub) => ({
      ...(await users.ensureUser(sub)),
      timezone: options.timezone ?? null,
    }),
  };

  const transport = options.syncActivities;
  const sync: NonNullable<AppDependencies["syncGarminActivities"]> = (
    credentials,
    ids = [],
  ) => {
    synced.push(credentials);
    knownIds.push(ids);
    return transport === undefined
      ? Promise.resolve([] as Activity[])
      : transport(credentials, ids);
  };

  const app = createApp({
    authProvider: { verify: (token) => Promise.resolve({ sub: token }) },
    userStore: accounts,
    loadGarminCredentials: (userId) =>
      Promise.resolve(stored.get(userId) ?? null),
    saveGarminCredentials: (userId, credentials) => {
      stored.set(userId, credentials);
      return Promise.resolve();
    },
    loadDecryptedGarminCredentials:
      options.loadDecrypted ??
      ((userId) => Promise.resolve(plain.get(userId) ?? null)),
    loadStoredFeed:
      options.loadStoredFeed ?? (() => Promise.resolve(emptyFeed())),
    authenticateGarmin: authenticate ?? (() => Promise.resolve(true)),
    syncGarminActivities: sync,
    syncGarminSupplements: (_userId, _credentials, today) => {
      supplementDates.push(today);
      return options.syncSupplements?.() ?? Promise.resolve();
    },
    now: options.now ?? (() => new Date()),
  });

  return { app, stored, plain, synced, knownIds, supplementDates };
}

/** An empty stored feed, so a route test never reads the database. */
function emptyFeed(): { model: null; activities: AnalyzedActivity[] } {
  return { model: null, activities: [] };
}

/** Lets a background supplementary pass settle so its per-account entry is released. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function request(path: string, subject: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${subject}`);
  return apiRequest(`http://localhost/api${path}`, { ...init, headers });
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

  it("binds stored credentials to the signed-in account", async () => {
    const { app, stored } = makeApp();

    const res = await app.fetch(
      request("/garmin/credentials", "athlete-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "rider-1", password: "secret" }),
      }),
    );

    expect(res.status).toBe(200);
    const saved = stored.get(1);
    if (saved === undefined) {
      throw new Error("expected stored credentials");
    }
    const keys = await credentialsKeyFromEnv("GARMIN_CREDENTIALS_KEY");
    expect(await decrypt(saved.passwordEncrypted, keys, 1)).toBe("secret");
    return expect(decrypt(saved.passwordEncrypted, keys, 2)).rejects.toThrow();
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

  it("passes the stored ids and fills their stored preview back in", async () => {
    const storedActivity: AnalyzedActivity = {
      id: 1,
      name: "Morning ride",
      type: "cycling",
      startDate: "2026-11-14T07:00:00Z",
      distance: 30000,
      movingTime: 3600,
      elapsedTime: 3700,
      totalElevationGain: 200,
      sampleCount: 2,
      samples: [
        { timestamp: "2026-11-14T07:00:00Z", heartRate: 130 },
        { timestamp: "2026-11-14T07:01:00Z", heartRate: 132 },
      ],
      laps: [
        { index: 1, distance: 1000 },
        { index: 2, distance: 2000 },
      ],
      strengthSets: [{ setType: "active", repetitions: 10, exercises: [] }],
      analysis: null,
      analysisError: null,
      programAnalysis: null,
      comment: null,
      coachReply: null,
    };
    const renamed: Activity = {
      id: 1,
      name: "Renamed ride",
      type: "cycling",
      startDate: "2026-11-14T07:00:00Z",
      distance: 30000,
      movingTime: 3600,
      elapsedTime: 3700,
      totalElevationGain: 200,
      samples: [],
    };
    const { app, plain, knownIds } = makeApp(undefined, {
      loadStoredFeed: () =>
        Promise.resolve({ model: null, activities: [storedActivity] }),
      syncActivities: () => Promise.resolve([renamed]),
    });
    plain.set(1, { username: "rider-1", password: "secret-1" });

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(knownIds).toEqual([[1]]);
    expect(await res.json()).toEqual({
      activities: [
        {
          ...renamed,
          samples: storedActivity.samples,
          laps: storedActivity.laps,
          strengthSets: storedActivity.strengthSets,
        },
      ],
    });
  });

  it("refreshes the supplementary data for the athlete's local day", async () => {
    const { app, plain, supplementDates } = makeApp(undefined, {
      timezone: "Europe/Oslo",
      now: () => new Date("2026-11-14T23:30:00Z"),
    });
    plain.set(1, { username: "rider-1", password: "secret-1" });

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(200);
    await settle();
    expect(supplementDates).toEqual(["2026-11-15"]);
  });

  it("reads an account without a time zone in UTC", async () => {
    const { app, plain, supplementDates } = makeApp(undefined, {
      now: () => new Date("2026-11-14T23:30:00Z"),
    });
    plain.set(1, { username: "rider-1", password: "secret-1" });

    await app.fetch(request("/garmin/activities", "athlete-1"));

    await settle();
    expect(supplementDates).toEqual(["2026-11-14"]);
  });

  it("does not sync an account without credentials", async () => {
    const { app, plain, synced } = makeApp();
    plain.set(1, { username: "rider-1", password: "secret-1" });

    const res = await app.fetch(request("/garmin/activities", "athlete-2"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "garmin_not_connected",
        message: "Not connected to Garmin",
      },
    });
    expect(synced).toEqual([]);
  });

  it("does not store credentials Garmin rejects", async () => {
    const { app, stored } = makeApp(() =>
      Promise.reject(
        // The contract the Garmin client raises for a 401 from the sidecar: a
        // fixable connection failure, not a session failure (ADR 0036).
        new GarminSidecarError("invalid Garmin credentials", 422, {
          code: "garmin_auth_failed",
        }),
      ),
    );

    const res = await app.fetch(
      request("/garmin/credentials", "athlete-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "rider-1", password: "wrong" }),
      }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: "garmin_auth_failed",
        message: "invalid Garmin credentials",
      },
    });
    expect(stored.size).toBe(0);
  });
});

describe("supplementary sync scheduling", () => {
  const credentials = { username: "rider-1", password: "secret-1" };
  const activity: Activity = {
    id: 1,
    name: "Morning ride",
    type: "cycling",
    startDate: "2026-11-14T07:00:00Z",
    distance: 30000,
    movingTime: 3600,
    elapsedTime: 3700,
    totalElevationGain: 200,
    samples: [],
  };

  it("answers with the activities while the supplementary pass runs", async () => {
    let finish: () => void = () => {};
    const { app, plain } = makeApp(undefined, {
      syncActivities: () => Promise.resolve([activity]),
      syncSupplements: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    plain.set(1, credentials);

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activities: [activity] });

    // The pass settles only after the response, which is the point: a slow
    // backfill must not hold the activities.
    finish();
    await settle();
  });

  it("logs a failing supplementary pass without failing the response", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { app, plain } = makeApp(undefined, {
        syncActivities: () => Promise.resolve([activity]),
        syncSupplements: () => Promise.reject(new Error("sidecar down")),
      });
      plain.set(1, credentials);

      const res = await app.fetch(request("/garmin/activities", "athlete-1"));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ activities: [activity] });

      await settle();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[1])).toContain("sidecar down");
    } finally {
      log.mockRestore();
    }
  });
});

describe("Garmin upstream failures", () => {
  const credentials = { username: "rider-1", password: "secret-1" };

  function credentialRequest(): Request {
    return request("/garmin/credentials", "athlete-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
  }

  it("passes the sidecar's status through on a sync", async () => {
    const { app, plain } = makeApp(undefined, {
      syncActivities: () =>
        Promise.reject(new GarminSidecarError("Garmin is rate limiting", 429)),
    });
    plain.set(1, credentials);

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "too_many_requests", message: "Garmin is rate limiting" },
    });
  });

  it("reports a sidecar failure without a status as unavailable", async () => {
    const { app, plain } = makeApp(undefined, {
      syncActivities: () =>
        Promise.reject(
          new GarminSidecarError(
            "sidecar returned a malformed activities payload",
          ),
        ),
    });
    plain.set(1, credentials);

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: {
        code: "service_unavailable",
        message: "sidecar returned a malformed activities payload",
      },
    });
  });

  it("reports an unexpected sync failure as unavailable", async () => {
    const { app, plain } = makeApp(undefined, {
      syncActivities: () => Promise.reject(new Error("boom")),
    });
    plain.set(1, credentials);

    const res = await app.fetch(request("/garmin/activities", "athlete-1"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: "service_unavailable", message: "Service Unavailable" },
    });
  });

  it("reports stored credentials that cannot be decrypted as unavailable", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { app } = makeApp(undefined, {
        loadDecrypted: () => Promise.reject(new Error("bad key")),
      });

      const res = await app.fetch(request("/garmin/activities", "athlete-1"));

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: {
          code: "service_unavailable",
          message:
            "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
        },
      });
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[1])).toContain(
        "GARMIN_CREDENTIALS_KEY",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("passes the sidecar's status through when validating credentials", async () => {
    const { app, stored } = makeApp(() =>
      Promise.reject(new GarminSidecarError("MFA is required", 403)),
    );

    const res = await app.fetch(credentialRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "MFA is required" },
    });
    expect(stored.size).toBe(0);
  });

  it("reports an unexpected credential failure as unavailable", async () => {
    const { app, stored } = makeApp(() => Promise.reject(new Error("boom")));

    const res = await app.fetch(credentialRequest());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: "service_unavailable", message: "Service Unavailable" },
    });
    expect(stored.size).toBe(0);
  });

  it("does not leak a credentials-key failure to the athlete", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    delete process.env.GARMIN_CREDENTIALS_KEY;
    try {
      const { app, stored } = makeApp();

      const res = await app.fetch(credentialRequest());

      expect(res.status).toBe(503);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("service_unavailable");
      expect(body.error.message).toBe(
        "Garmin is not available right now. Try again later.",
      );
      expect(JSON.stringify(body)).not.toContain("GARMIN_CREDENTIALS_KEY");
      expect(stored.size).toBe(0);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[1])).toContain(
        "GARMIN_CREDENTIALS_KEY",
      );
    } finally {
      process.env.GARMIN_CREDENTIALS_KEY = "garmin-route-test-key";
      log.mockRestore();
    }
  });
});
