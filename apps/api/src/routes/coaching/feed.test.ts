import { describe, expect, it } from "bun:test";
import type { ActivityFeed } from "../../coaching/feed/presenter.js";
import {
  GarminCredentialsError,
  LlmCredentialsError,
} from "../../coaching/feed/errors.js";
import {
  GarminNotConnectedError,
  GarminSidecarError,
} from "../../garmin/client.js";
import { LlmAuthError, LlmProviderError } from "../../llm/openrouter.js";
import type { StoredPlan } from "../../plans/store.js";
import {
  authenticatedRequest,
  makeTestApp as makeApp,
  MemoryPlanStore,
} from "../../testFixtures/app.js";

describe("coaching activity feed", () => {
  it("loads activities for the signed-in account", async () => {
    const requested = { userId: null as number | null };
    const app = makeApp({
      loadActivities: (userId) => {
        requested.userId = userId;
        return Promise.resolve({ model: "test-model", activities: [] });
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities"),
    );

    expect(res.status).toBe(200);
    expect(requested.userId).toBe(42);
  });

  it("returns the stored feed without syncing Garmin", async () => {
    const requested = { userId: null as number | null };
    const app = makeApp({
      loadStoredFeed: (userId) => {
        requested.userId = userId;
        return Promise.resolve({
          model: "test-model",
          activities: [
            {
              id: 7,
              name: "Morning Run",
              type: "running",
              startDate: "2026-10-21T06:30:00Z",
              distance: 5000,
              movingTime: 1500,
              elapsedTime: 1600,
              totalElevationGain: 20,
              sampleCount: 10,
              samples: [],
              analysis: null,
              analysisError: null,
              programAnalysis: null,
              comment: null,
              coachReply: null,
            },
          ],
        });
      },
      loadActivityTrainingLoads: () =>
        Promise.resolve({
          byDate: new Map([
            ["2026-10-21", { tss: 85, atl: 29, ctl: 20, tsb: -20 }],
          ]),
          byActivityId: new Map([[7, 40]]),
        }),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/cached"),
    );

    expect(res.status).toBe(200);
    expect(requested.userId).toBe(42);
    const body = (await res.json()) as {
      activities: Array<{
        name: string;
        activityTss?: number | null;
        trainingLoad?: { tss: number } | null;
      }>;
    };
    expect(body.activities[0]?.name).toBe("Morning Run");
    expect(body.activities[0]?.activityTss).toBe(40);
    expect(body.activities[0]?.trainingLoad?.tss).toBe(85);
  });

  it("returns an empty feed when nothing has been cached yet", async () => {
    const app = makeApp({
      loadStoredFeed: () => Promise.resolve({ model: null, activities: [] }),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/cached"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ model: null, activities: [] });
  });

  it("returns the coach feedback already stored with the feed", async () => {
    const app = makeApp({
      loadStoredFeed: () =>
        Promise.resolve({
          model: "test-model",
          activities: [
            {
              id: 7,
              name: "Morning Run",
              type: "running",
              startDate: "2026-10-21T06:30:00Z",
              distance: 5000,
              movingTime: 1500,
              elapsedTime: 1600,
              totalElevationGain: 20,
              sampleCount: 10,
              samples: [],
              analysis: null,
              analysisError: null,
              programAnalysis: null,
              comment: "Felt strong on the climbs.",
              coachReply: {
                text: "Good pacing; keep the climbs easy next time.",
                model: "test-model",
                generatedAt: "2026-10-21T09:00:00.000Z",
              },
            },
          ],
        }),
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/cached"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activities: Array<{
        comment: string | null;
        coachReply: { text: string; generatedAt: string } | null;
      }>;
    };
    expect(body.activities[0]?.comment).toBe("Felt strong on the climbs.");
    expect(body.activities[0]?.coachReply?.text).toBe(
      "Good pacing; keep the climbs easy next time.",
    );
    expect(body.activities[0]?.coachReply?.generatedAt).toBe(
      "2026-10-21T09:00:00.000Z",
    );
  });
});

describe("coaching activity analysis", () => {
  function feedWithAnalysis(generatedAt: string): ActivityFeed {
    return {
      model: "test-model",
      activities: [
        {
          id: 7,
          name: "Morning Run",
          type: "running",
          startDate: "2026-10-21T06:30:00Z",
          distance: 5000,
          movingTime: 1500,
          elapsedTime: 1600,
          totalElevationGain: 20,
          sampleCount: 0,
          samples: [],
          analysis: {
            text: "Steady aerobic effort.",
            model: "test-model",
            generatedAt,
          },
          analysisError: null,
          programAnalysis: null,
          comment: null,
          coachReply: null,
        },
      ],
    };
  }

  const storedPlan: StoredPlan = {
    plan: {} as StoredPlan["plan"],
    answersUpdatedAt: null,
    coachingInputsUpdatedAt: null,
    activitiesUpdatedAt: new Date("2026-10-21T08:00:00Z"),
    generatedAt: new Date("2026-10-21T08:00:00Z"),
  };

  it("starts a plan revision when an activity was analysed after the plan", async () => {
    let triggered = false;
    const requested: { today: string | null } = { today: null };
    const app = makeApp({
      planStore: new MemoryPlanStore(storedPlan),
      loadActivities: () =>
        Promise.resolve(feedWithAnalysis("2026-10-21T09:00:00Z")),
      triggerPlanGeneration: (deps, options) => {
        triggered = true;
        requested.today = options.today;
        expect(deps.loadActivities).toBeDefined();
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest(
        "/api/coaching/activities?today=2026-10-21&timezone=Europe%2FOslo",
      ),
    );

    expect(res.status).toBe(200);
    expect(triggered).toBe(true);
    expect(requested.today).toBe("2026-10-21");
  });

  it("does not revise when the analysis predates the plan", async () => {
    let triggered = false;
    const app = makeApp({
      planStore: new MemoryPlanStore(storedPlan),
      loadActivities: () =>
        Promise.resolve(feedWithAnalysis("2026-10-21T07:00:00Z")),
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities?today=2026-10-21"),
    );

    expect(res.status).toBe(200);
    expect(triggered).toBe(false);
  });
});

describe("coaching activity feed failures", () => {
  const failures = [
    {
      name: "a Garmin account that is not connected",
      error: new GarminNotConnectedError(),
      status: 409,
      code: "garmin_not_connected",
      message: "Not connected to Garmin",
    },
    {
      name: "Garmin credentials the sidecar rejects",
      error: new GarminSidecarError("invalid Garmin credentials", 422, {
        code: "garmin_auth_failed",
      }),
      status: 422,
      code: "garmin_auth_failed",
      message: "invalid Garmin credentials",
    },
    {
      name: "a Garmin rate limit",
      error: new GarminSidecarError("Garmin is rate limiting", 429),
      status: 429,
      code: "too_many_requests",
      message: "Garmin is rate limiting",
    },
    {
      name: "a malformed sidecar payload",
      error: new GarminSidecarError(
        "sidecar returned a malformed activities payload",
      ),
      status: 503,
      code: "service_unavailable",
      message: "sidecar returned a malformed activities payload",
    },
    {
      name: "stored Garmin credentials that cannot be decrypted",
      error: new GarminCredentialsError(
        "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
      ),
      status: 503,
      code: "service_unavailable",
      message:
        "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
    },
    {
      name: "a stored OpenRouter key that cannot be decrypted",
      error: new LlmCredentialsError(
        "OpenRouter credentials are unavailable (check LLM_CREDENTIALS_KEY)",
      ),
      status: 503,
      code: "service_unavailable",
      message:
        "OpenRouter credentials are unavailable (check LLM_CREDENTIALS_KEY)",
    },
    {
      name: "an OpenRouter key the provider rejects",
      error: new LlmAuthError("invalid OpenRouter API key"),
      status: 422,
      code: "llm_key_invalid",
      message: "invalid OpenRouter API key",
    },
    {
      name: "an OpenRouter account without credits",
      error: new LlmProviderError(
        "OpenRouter account has insufficient credits",
        402,
      ),
      status: 402,
      code: "payment_required",
      message: "OpenRouter account has insufficient credits",
    },
    {
      name: "an OpenRouter failure without a status",
      error: new LlmProviderError(
        "could not reach OpenRouter for the completion",
      ),
      status: 503,
      code: "service_unavailable",
      message: "could not reach OpenRouter for the completion",
    },
    {
      name: "an unexpected failure",
      error: new Error("boom"),
      status: 503,
      code: "service_unavailable",
      message: "Service Unavailable",
    },
  ];

  for (const failure of failures) {
    it(`reports ${failure.name}`, async () => {
      const app = makeApp({
        loadActivities: () => Promise.reject(failure.error),
      });

      const res = await app.fetch(
        authenticatedRequest("/api/coaching/activities"),
      );

      expect(res.status).toBe(failure.status);
      expect(await res.json()).toEqual({
        error: { code: failure.code, message: failure.message },
      });
    });
  }
});

describe("coaching activity deletion", () => {
  it("deletes an imported activity and triggers a plan revision", async () => {
    const deleted: { userId: number | null; activityId: string | null } = {
      userId: null,
      activityId: null,
    };
    let triggered = false;

    const app = makeApp({
      deleteImportedActivity: (userId, activityId) => {
        deleted.userId = userId;
        deleted.activityId = activityId;
        return Promise.resolve();
      },
      triggerPlanGeneration: () => {
        triggered = true;
        return Promise.resolve(true);
      },
    });

    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123?today=2026-10-21", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(200);
    expect(deleted).toEqual({ userId: 42, activityId: "123" });
    expect(triggered).toBe(true);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Activity deleted");
  });

  it("requires a today date when deleting an activity", async () => {
    const app = makeApp({});
    const res = await app.fetch(
      authenticatedRequest("/api/coaching/activities/123", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(400);
  });
});
