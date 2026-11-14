import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activitiesResponseSchema,
  DAILY_HEALTH_METRIC_KEYS,
  garminDailyResponseSchema,
  garminMetricsResponseSchema,
  type ActivitiesResponse,
  type Activity,
} from "@killingit/shared";
import { garminSyncRequestBody } from "./client.js";

/**
 * The TypeScript half of the sidecar contract. The Python sidecar builds its
 * response dicts by hand, and these schemas are what `client.ts` parses them
 * with, so the two can silently drift apart. `services/garmin/test_contract.py`
 * pins the sidecar to the committed fixtures in `services/garmin/contract/`,
 * and this test parses those same fixtures with the shared schemas and asserts
 * the fields the app reads survive. A rename on either side fails one of the
 * two suites instead of production.
 *
 * The fixtures are regenerated from the sidecar (see
 * `services/garmin/README.md`); this test never writes.
 */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const CONTRACT_DIR = join(REPO_ROOT, "services", "garmin", "contract");

/** Reads one committed fixture. Resolved from the repo root, never the cwd. */
function readContract(name: string): unknown {
  const parsed: unknown = JSON.parse(
    readFileSync(join(CONTRACT_DIR, name), "utf8"),
  );
  return parsed;
}

function activityOfType(response: ActivitiesResponse, type: string): Activity {
  const activity = response.activities.find((entry) => entry.type === type);
  if (activity === undefined) {
    throw new Error(`the sync fixture has no ${type} activity`);
  }
  return activity;
}

describe("Garmin sidecar contract fixtures", () => {
  it("pins the /sync request body, including the known activity ids", () => {
    // The Python half validates the same file through `SyncRequest`, so a
    // rename of `knownActivityIds` fails one of the two suites.
    const fixture = readContract("sync-request.json") as Record<
      string,
      unknown
    >;

    expect(
      garminSyncRequestBody(
        { username: "athlete@example.com", password: "secret" },
        [1, 3],
      ),
    ).toEqual(fixture);
  });

  it("parses the whole /sync body with the shared response schema", () => {
    const response = activitiesResponseSchema.parse(readContract("sync.json"));

    expect(
      response.activities.map((activity) => [activity.id, activity.type]),
    ).toEqual([
      [1, "running"],
      [2, "road_biking"],
      [3, "strength_training"],
    ]);
    expect(activityOfType(response, "running")).toMatchObject({
      name: "Morning Run",
      startDate: "2026-10-01T04:30:00Z",
      distance: 5000,
      movingTime: 1500,
      elapsedTime: 1580,
      totalElevationGain: 42,
      averageSpeed: 3.33,
      maxSpeed: 4.12,
      averageHeartRate: 148,
    });
  });

  it("parses every channel of a recorded sample and keeps omitted ones absent", () => {
    const run = activityOfType(
      activitiesResponseSchema.parse(readContract("sync.json")),
      "running",
    );

    expect(run.samples).toEqual([
      {
        timestamp: "2026-10-01T06:30:00Z",
        latitude: 59.91,
        longitude: 10.75,
        heartRate: 138,
        power: 240,
        temperature: 11.5,
        speed: 3.1,
        elevation: 18,
        cadence: 152,
        distance: 0,
      },
      {
        // The device recorded no position or temperature here, so the sample
        // must not claim a zero for them.
        timestamp: "2026-10-01T06:31:00Z",
        heartRate: 148,
        power: 265,
        speed: 3.4,
        elevation: 22,
        cadence: 154,
        distance: 1000,
      },
      {
        timestamp: "2026-10-01T06:32:00Z",
        latitude: 59.92,
        longitude: 10.76,
        heartRate: 151,
        power: 270,
        temperature: 11.6,
        speed: 3.45,
        elevation: 24,
        cadence: 156,
        distance: 2000,
      },
    ]);
  });

  it("parses lap structure, its channels and both cadence families", () => {
    const run = activityOfType(
      activitiesResponseSchema.parse(readContract("sync.json")),
      "running",
    );
    const laps = run.laps ?? [];

    expect(laps[0]).toEqual({
      index: 1,
      type: "active",
      startTime: "2026-10-01T04:30:00Z",
      distance: 1600,
      movingTime: 470,
      elapsedTime: 480,
      averageHeartRate: 140,
      maxHeartRate: 149,
      averagePower: 245,
      maxPower: 280,
      averageSpeed: 3.4,
      averageCadence: 152,
      totalElevationGain: 18,
    });
    // Garmin's already-total lap cadence, then its per-leg fallback doubled to
    // steps per minute, then a lap without cadence at all.
    expect(laps.map((lap) => lap.averageCadence)).toEqual([
      152,
      154,
      undefined,
    ]);
  });

  it("parses strength sets, including a rest set and a bodyweight set", () => {
    const strength = activityOfType(
      activitiesResponseSchema.parse(readContract("sync.json")),
      "strength_training",
    );

    expect(strength.strengthSets).toEqual([
      {
        setType: "active",
        startTime: "2026-10-05T16:02:00Z",
        durationSeconds: 45,
        repetitions: 10,
        weightKg: 12,
        exercises: [{ category: "SQUAT", name: "GOBLET_SQUAT" }],
      },
      // The sidecar omits an empty exercise list; the schema defaults it.
      { setType: "rest", durationSeconds: 90, exercises: [] },
      {
        setType: "active",
        startTime: "2026-10-05T16:05:00Z",
        durationSeconds: 40,
        repetitions: 8,
        exercises: [{ category: "PUSH_UP", name: null }],
      },
    ]);
  });

  it("parses the /metrics body with its weight, body fat and FTP history", () => {
    const response = garminMetricsResponseSchema.parse(
      readContract("metrics.json"),
    );

    expect(response).toEqual({
      metrics: [
        { date: "2026-10-01", weightKg: 78.5, bodyFatPercent: 24.5 },
        { date: "2026-10-08", weightKg: 78.02, bodyFatPercent: 24.1 },
        { date: "2026-10-15", weightKg: 78.2 },
      ],
      ftp: [
        { date: "2026-10-01", watts: 255 },
        { date: "2026-10-20", watts: 262 },
      ],
    });
  });

  it("parses the /daily body and covers every catalogued health metric", () => {
    const response = garminDailyResponseSchema.parse(
      readContract("daily.json"),
    );

    expect(response).toMatchObject({
      date: "2026-11-12",
      metrics: {
        resting_heart_rate: 52,
        sleep_duration: 430,
        sleep_score: 82,
        hrv: 48,
        spo2: 96,
        respiration: 14.2,
        training_readiness: 78,
        recovery_time: 600,
        vo2max: 48.5,
        vo2max_cycling: 43,
      },
    });
    // An unknown key fails the parse outright, so a fixture that still holds
    // the whole catalog proves the sidecar and the catalog agree on its names.
    expect(Object.keys(response.metrics)).toHaveLength(
      DAILY_HEALTH_METRIC_KEYS.length,
    );
  });
});
