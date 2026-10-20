import { describe, expect, it } from "bun:test";
import {
  activitiesResponseSchema,
  activitySchema,
  greetingSchema,
  healthSchema,
} from "./index";

describe("healthSchema", () => {
  it("accepts a valid health payload", () => {
    const parsed = healthSchema.parse({
      status: "ok",
      service: "api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
    expect(parsed.status).toBe("ok");
  });

  it("rejects an invalid status", () => {
    expect(() => healthSchema.parse({ status: "down" })).toThrow();
  });
});

describe("greetingSchema", () => {
  it("accepts a string message", () => {
    expect(greetingSchema.parse({ message: "hello" }).message).toBe("hello");
  });
});

describe("activitySchema", () => {
  const summary = {
    id: 1,
    name: "Morning Run",
    type: "running",
    startDate: "2026-10-01T06:30:00Z",
    distance: 5000,
    movingTime: 1500,
    elapsedTime: 1600,
    totalElevationGain: 55,
  } satisfies Record<string, unknown>;

  it("accepts a summary with timeseries samples", () => {
    const parsed = activitySchema.parse({
      ...summary,
      samples: [
        {
          timestamp: "2026-10-01T06:30:00Z",
          latitude: 59.91,
          longitude: 10.75,
          heartRate: 140,
          power: 250,
          temperature: 12.5,
          speed: 3.2,
          distance: 10,
          elevation: 20,
          cadence: 80,
        },
      ],
    });
    expect(parsed.samples[0]?.heartRate).toBe(140);
  });

  it("allows samples with only a timestamp", () => {
    const parsed = activitySchema.parse({
      ...summary,
      samples: [{ timestamp: "2026-10-01T06:30:00Z" }],
    });
    expect(parsed.samples[0]?.power).toBeUndefined();
  });

  it("defaults missing samples to an empty list", () => {
    expect(activitySchema.parse(summary).samples).toEqual([]);
  });
});

describe("activitiesResponseSchema", () => {
  it("parses a list of activities", () => {
    const parsed = activitiesResponseSchema.parse({
      activities: [
        {
          id: 1,
          name: "Morning Run",
          type: "running",
          startDate: "2026-10-01T06:30:00Z",
          distance: 5000,
          movingTime: 1500,
          elapsedTime: 1600,
          totalElevationGain: 55,
          samples: [{ timestamp: "2026-10-01T06:30:00Z" }],
        },
      ],
    });
    expect(parsed.activities[0]?.samples).toHaveLength(1);
  });

  it("rejects a payload without an activities array", () => {
    expect(() =>
      activitiesResponseSchema.parse({ activities: "nope" }),
    ).toThrow();
  });
});
