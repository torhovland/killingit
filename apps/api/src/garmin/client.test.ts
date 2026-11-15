import { afterEach, describe, expect, it } from "bun:test";
import {
  authenticateGarmin,
  GarminNotConnectedError,
  GarminSidecarError,
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

/**
 * Stubs the global `fetch`, recording every request. A metadata request is
 * answered by `metadata`; anything else is the sidecar response.
 */
function stubFetch(options: {
  body?: unknown;
  status?: number;
  metadata?: () => Response;
}): SidecarRequest[] {
  const requests: SidecarRequest[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push({ url, init });
    if (url.includes("metadata.google.internal")) {
      return Promise.resolve(options.metadata?.() ?? new Response("id-token"));
    }
    return Promise.resolve(
      new Response(JSON.stringify(options.body ?? {}), {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return requests;
}

/** Stubs the sidecar with one JSON response and no configured audience. */
function stubSidecarResponse(body: unknown, status = 200): SidecarRequest[] {
  process.env.GARMIN_SIDECAR_URL = "http://sidecar.test";
  delete process.env.GARMIN_SIDECAR_AUDIENCE;
  return stubFetch({ body, status });
}

/** The metadata and sidecar requests a stubbed `fetch` recorded separately. */
function metadataRequests(
  requests: readonly SidecarRequest[],
): SidecarRequest[] {
  return requests.filter((request) =>
    request.url.includes("metadata.google.internal"),
  );
}

/** The authorization header of every sidecar request, in order. */
function sidecarAuthorizations(
  requests: readonly SidecarRequest[],
): (string | null)[] {
  return requests
    .filter((request) => !request.url.includes("metadata.google.internal"))
    .map((request) => new Headers(request.init?.headers).get("authorization"));
}

/** The JSON body a stubbed sidecar request sent. */
function requestBodyOf(request: SidecarRequest | undefined): unknown {
  const body = request?.init?.body;
  if (typeof body !== "string") {
    throw new Error("expected the sidecar request to carry a JSON body");
  }
  return JSON.parse(body) as unknown;
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
      [],
      () => Promise.resolve(activities),
    );
    expect(result).toEqual(activities);
    expect(result[0]?.samples[0]?.heartRate).toBe(140);
  });

  it("propagates a transport rejection", async () => {
    const promise = syncGarminActivities(
      { username: "u", password: "p" },
      [],
      () => Promise.reject(new GarminSidecarError("boom")),
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

  it("sends the ids the API already stores so their details are skipped", async () => {
    const requests = stubSidecarResponse({ activities: [] });

    await syncGarminActivities({ username: "u", password: "p" }, [1, 3]);

    const body = requestBodyOf(requests[0]);
    expect(body).toEqual({
      username: "u",
      password: "p",
      knownActivityIds: ["1", "3"],
    });
  });

  it("sends an empty known-id list when nothing is stored yet", async () => {
    const requests = stubSidecarResponse({ activities: [] });

    await syncGarminActivities({ username: "u", password: "p" });

    expect(requestBodyOf(requests[0])).toEqual({
      username: "u",
      password: "p",
      knownActivityIds: [],
    });
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

/** Runs a promise that must reject and returns the thrown error. */
async function caughtError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
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

  it("reports a rejected Garmin login as a fixable connection failure", async () => {
    stubSidecarResponse({ detail: "invalid Garmin credentials" }, 401);

    const error = await caughtError(
      authenticateGarmin({ username: "u", password: "p" }),
    );

    expect(error).toBeInstanceOf(GarminSidecarError);
    // A third-party login failure must not answer 401, which the web client
    // would spend renewing its own session (ADR 0036).
    expect((error as GarminSidecarError).status).toBe(422);
    expect((error as GarminSidecarError).code).toBe("garmin_auth_failed");
    expect((error as Error).message).toBe("invalid Garmin credentials");
  });
});

describe("sidecar authentication", () => {
  it("sends no authorization header when no audience is configured", async () => {
    const requests = stubSidecarResponse({});

    await syncGarminMetrics({ username: "u", password: "p" });

    expect(metadataRequests(requests)).toHaveLength(0);
    expect(sidecarAuthorizations(requests)).toEqual([null]);
    expect(requests[0]?.url).toBe("http://sidecar.test/metrics");
  });

  it("mints an identity token for the configured audience", async () => {
    process.env.GARMIN_SIDECAR_URL = "http://sidecar.test";
    process.env.GARMIN_SIDECAR_AUDIENCE = "https://garmin-test.example.run.app";
    const requests = stubFetch({
      metadata: () => new Response("id-token", { status: 200 }),
    });

    await syncGarminMetrics({ username: "u", password: "p" });

    const [metadata] = metadataRequests(requests);
    expect(metadata?.url).toContain(
      "audience=https%3A%2F%2Fgarmin-test.example.run.app",
    );
    expect(metadata?.init?.headers).toEqual({ "Metadata-Flavor": "Google" });
    expect(sidecarAuthorizations(requests)).toEqual(["Bearer id-token"]);
  });

  it("caches the identity token until it expires", async () => {
    process.env.GARMIN_SIDECAR_URL = "http://sidecar.test";
    process.env.GARMIN_SIDECAR_AUDIENCE = "https://cached.example.run.app";
    let tokens = 0;
    const requests = stubFetch({
      metadata: () => new Response(`token-${(tokens += 1)}`, { status: 200 }),
    });
    const realNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      await syncGarminMetrics({ username: "u", password: "p" });
      now += 60_000;
      await syncGarminMetrics({ username: "u", password: "p" });
      expect(metadataRequests(requests)).toHaveLength(1);

      now += 46 * 60 * 1000;
      await syncGarminMetrics({ username: "u", password: "p" });
      expect(metadataRequests(requests)).toHaveLength(2);
      expect(sidecarAuthorizations(requests)).toEqual([
        "Bearer token-1",
        "Bearer token-1",
        "Bearer token-2",
      ]);
    } finally {
      Date.now = realNow;
    }
  });

  it("throws when the token endpoint fails", async () => {
    process.env.GARMIN_SIDECAR_URL = "http://sidecar.test";
    process.env.GARMIN_SIDECAR_AUDIENCE = "https://broken.example.run.app";
    stubFetch({
      metadata: () => new Response("nope", { status: 500 }),
    });

    const promise = syncGarminMetrics({ username: "u", password: "p" });
    await expectRejectsWith(promise, GarminSidecarError);
  });
});

describe("sidecar URL configuration", () => {
  it("falls back to the local default when the env var is empty", async () => {
    process.env.GARMIN_SIDECAR_URL = "";
    delete process.env.GARMIN_SIDECAR_AUDIENCE;
    const requests = stubFetch({ body: {} });

    await syncGarminMetrics({ username: "u", password: "p" });

    expect(requests[0]?.url).toBe("http://localhost:8000/metrics");
  });
});

describe("error classes", () => {
  it("reports a missing Garmin connection without a session failure", () => {
    const err = new GarminNotConnectedError();
    expect(err.status).toBe(409);
    expect(err.code).toBe("garmin_not_connected");
    expect(err.message).toBe("Not connected to Garmin");
  });
});
