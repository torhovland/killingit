import { describe, expect, it } from "bun:test";
import {
  authenticateGarmin,
  GarminAuthError,
  GarminSidecarError,
  syncGarminActivities,
} from "./client.js";

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

describe("error classes", () => {
  it("GarminAuthError carries status 401", () => {
    const err = new GarminAuthError("bad");
    expect(err.status).toBe(401);
  });
});
