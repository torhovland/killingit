import { afterEach, describe, expect, it } from "bun:test";
import {
  authenticateGarmin,
  GarminAuthError,
  GarminSidecarError,
  sidecarAuthHeaders,
  syncGarminActivities,
  syncGarminDailyMetrics,
  syncGarminMetrics,
} from "./client.js";

const originalFetch = globalThis.fetch;
const originalSidecarUrl = process.env.GARMIN_SIDECAR_URL;
const originalSidecarAudience = process.env.GARMIN_SIDECAR_AUDIENCE;

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("GARMIN_SIDECAR_URL", originalSidecarUrl);
  restoreEnv("GARMIN_SIDECAR_AUDIENCE", originalSidecarAudience);
});

/** Restores an environment variable to its value before the test. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** The request a stubbed sidecar `fetch` recorded. */
interface SidecarRequest {
  url: string;
  init: RequestInit | undefined;
}

/** Stubs the global `fetch` with one JSON response and records the request. */
function stubSidecarResponse(body: unknown): SidecarRequest[] {
  process.env.GARMIN_SIDECAR_URL = "http://sidecar.test";
  delete process.env.GARMIN_SIDECAR_AUDIENCE;
  const requests: SidecarRequest[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      init,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return requests;
}

/** The minimal activity payload the sidecar's `/sync` returns. */
const sidecarActivity = {
  id: 1,
  name: "Morning Run",
  type: "running",
  startDate: "2026-10-01T06:30:00Z",
  distance: 5000,
  movingTime: 1500,
  elapsedTime: 1600,
  totalElevationGain: 55,
};

describe("syncGarminActivities", () => {
  it("returns activities from the transport", async () => {
    const activities = [
      {
        id: 1,
        name: "Morning Run",
        type: "running",
        startDate: "2026-10-01T06:30:00Z",
        distance: 5000,
        movingTime: 1500,
        elapsedTime: 1600,
        totalElevationGain: 55,
        samples: [
          {
            timestamp: "2026-10-01T06:30:00Z",
            latitude: 59.91,
            longitude: 10.75,
            heartRate: 140,
            power: 250,
            temperature: 12.5,
          },
        ],
      },
    ];
    const result = await syncGarminActivities(
      { username: "u", password: "p" },
      () => Promise.resolve(activities),
    );
    expect(result).toEqual(activities);
    expect(result[0]?.samples[0]?.heartRate).toBe(140);
  });

  it("propagates a transport rejection", async () => {
    const promise = syncGarminActivities({ username: "u", password: "p" }, () =>
      Promise.reject(new GarminSidecarError("boom")),
    );
    await expectRejectsWith(promise, GarminSidecarError);
  });

  it("validates the activities payload from the sidecar", async () => {
    const requests = stubSidecarResponse({ activities: [sidecarActivity] });

    const result = await syncGarminActivities({ username: "u", password: "p" });

    expect(result).toEqual([{ ...sidecarActivity, samples: [] }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://sidecar.test/sync");
  });

  it("rejects a malformed activities payload with a typed error", async () => {
    stubSidecarResponse({
      activities: [{ ...sidecarActivity, id: "not-a-number" }],
    });

    const promise = syncGarminActivities({ username: "u", password: "p" });
    await expectRejectsWith(promise, GarminSidecarError);
  });

  it("rejects a non-array activities payload with a typed error", async () => {
    stubSidecarResponse({ activities: "nope" });

    const promise = syncGarminActivities({ username: "u", password: "p" });
    await expectRejectsWith(promise, GarminSidecarError);
  });

  it("times out the sidecar request", async () => {
    const requests = stubSidecarResponse({ activities: [] });

    await syncGarminActivities({ username: "u", password: "p" });

    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });
});

/** Asserts a promise rejects with the given error type. */
async function expectRejectsWith<T extends Error>(
  promise: Promise<unknown>,
  type: new (...args: never[]) => T,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(type);
    return;
  }
  throw new Error("expected promise to reject");
}

describe("syncGarminMetrics", () => {
  it("returns normalized body-composition and FTP samples from the transport", async () => {
    const snapshot = {
      metrics: [
        { date: "2026-10-01", weightKg: 78.5, bodyFatPercent: 24.5 },
        { date: "2026-10-02", weightKg: 78.2 },
      ],
      ftp: [{ date: "2026-10-01", watts: 255 }],
    };
    const result = await syncGarminMetrics(
      { username: "u", password: "p" },
      () => Promise.resolve(snapshot),
    );

    expect(result).toEqual(snapshot);
  });

  it("propagates a transport rejection", async () => {
    const promise = syncGarminMetrics({ username: "u", password: "p" }, () =>
      Promise.reject(new GarminSidecarError("boom")),
    );
    await expectRejectsWith(promise, GarminSidecarError);
  });
});

describe("syncGarminDailyMetrics", () => {
  it("returns one day's normalized metrics from the transport", async () => {
    const day = {
      date: "2026-11-02",
      metrics: {
        resting_heart_rate: 52,
        sleep_duration: 430,
        hrv: 48,
      },
    };
    const result = await syncGarminDailyMetrics(
      { username: "u", password: "p" },
      "2026-11-02",
      (_credentials, date) => Promise.resolve({ ...day, date }),
    );

    expect(result).toEqual(day);
  });

  it("propagates a transport rejection", async () => {
    const promise = syncGarminDailyMetrics(
      { username: "u", password: "p" },
      "2026-11-02",
      () => Promise.reject(new GarminSidecarError("rate limit", 429)),
    );
    await expectRejectsWith(promise, GarminSidecarError);
  });
});

describe("authenticateGarmin", () => {
  it("resolves true on success", async () => {
    const ok = await authenticateGarmin({ username: "u", password: "p" }, () =>
      Promise.resolve(),
    );
    expect(ok).toBe(true);
  });

  it("propagates GarminAuthError", async () => {
    const promise = authenticateGarmin({ username: "u", password: "p" }, () =>
      Promise.reject(new GarminAuthError("invalid Garmin credentials")),
    );
    await expectRejectsWith(promise, GarminAuthError);
  });
});

describe("sidecarAuthHeaders", () => {
  it("returns no auth headers when no audience is configured", async () => {
    const headers = await sidecarAuthHeaders({}, (() =>
      Promise.reject(new Error("must not fetch"))) as unknown as typeof fetch);
    expect(headers).toEqual({});
  });

  it("mints an identity token for the configured audience", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response("id-token", { status: 200 }));
    }) as unknown as typeof fetch;

    const headers = await sidecarAuthHeaders(
      { GARMIN_SIDECAR_AUDIENCE: "https://garmin-test.example.run.app" },
      fetchFn,
    );

    expect(headers).toEqual({ authorization: "Bearer id-token" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain(
      "audience=https%3A%2F%2Fgarmin-test.example.run.app",
    );
    expect(calls[0]?.init?.headers).toEqual({ "Metadata-Flavor": "Google" });
  });

  it("caches the identity token until it expires", async () => {
    let fetches = 0;
    let now = 1_000;
    const fetchFn = (() => {
      fetches += 1;
      return Promise.resolve(new Response(`token-${fetches}`, { status: 200 }));
    }) as unknown as typeof fetch;
    const env = { GARMIN_SIDECAR_AUDIENCE: "https://cached.example.run.app" };

    const first = await sidecarAuthHeaders(env, fetchFn, () => now);
    now += 60_000;
    const second = await sidecarAuthHeaders(env, fetchFn, () => now);
    expect(second).toEqual(first);
    expect(fetches).toBe(1);

    now += 46 * 60 * 1000;
    const refreshed = await sidecarAuthHeaders(env, fetchFn, () => now);
    expect(refreshed.authorization).toBe("Bearer token-2");
    expect(fetches).toBe(2);
  });

  it("throws when the token endpoint fails", async () => {
    const promise = sidecarAuthHeaders(
      { GARMIN_SIDECAR_AUDIENCE: "https://broken.example.run.app" },
      (() =>
        Promise.resolve(
          new Response("nope", { status: 500 }),
        )) as unknown as typeof fetch,
    );
    await expectRejectsWith(promise, GarminSidecarError);
  });
});

describe("error classes", () => {
  it("GarminAuthError carries status 401", () => {
    const err = new GarminAuthError("bad");
    expect(err.status).toBe(401);
  });
});
