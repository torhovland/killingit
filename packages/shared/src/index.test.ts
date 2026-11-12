import { describe, expect, it } from "bun:test";
import {
  activitiesResponseSchema,
  activityAverageSpeed,
  activitySchema,
  activityUsesPace,
  addDays,
  API_CONTRACT_VERSION,
  athleteEventSchema,
  athleteIdentitySchema,
  athleteThresholdSchema,
  bikeWorkoutSchema,
  cadenceUnit,
  calendarResponseSchema,
  coachQuestionSchema,
  currentUserSchema,
  dailyHealthPointSchema,
  dayPlanSchema,
  dietSummaryResponseSchema,
  fitnessHistoryResponseSchema,
  formatActivityPaceOrSpeed,
  formatActivityType,
  formatDuration,
  formatPace,
  formatSpeed,
  garminConnectionStatusSchema,
  greetingSchema,
  hasLapStructure,
  healthSchema,
  isRunningActivity,
  llmSettingsSchema,
  paceUnitLabel,
  paceUnitMetres,
  periodReviewSchema,
  planDateSchema,
  questionSchema,
  trainingLoadSchema,
  weatherIconSchema,
  zonedDateTime,
} from "./index";

describe("package barrel", () => {
  it("re-exports a symbol from every shared module", () => {
    const surface = [
      API_CONTRACT_VERSION,
      addDays,
      athleteEventSchema,
      athleteIdentitySchema,
      athleteThresholdSchema,
      bikeWorkoutSchema,
      calendarResponseSchema,
      coachQuestionSchema,
      currentUserSchema,
      dailyHealthPointSchema,
      dayPlanSchema,
      dietSummaryResponseSchema,
      fitnessHistoryResponseSchema,
      formatDuration,
      garminConnectionStatusSchema,
      llmSettingsSchema,
      periodReviewSchema,
      planDateSchema,
      questionSchema,
      trainingLoadSchema,
      weatherIconSchema,
      zonedDateTime,
    ];

    for (const symbol of surface) {
      expect(symbol).toBeDefined();
    }
  });
});

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

  it("carries the recorded average and maximum speed", () => {
    const parsed = activitySchema.parse({
      ...summary,
      averageSpeed: 3.2,
      maxSpeed: 4.1,
    });
    expect(parsed.averageSpeed).toBe(3.2);
    expect(parsed.maxSpeed).toBe(4.1);
  });

  it("carries recorded laps with their averages", () => {
    const lap = {
      index: 2,
      type: "active",
      distance: 1200,
      movingTime: 240,
      averageHeartRate: 168,
      maxHeartRate: 175,
      averagePower: 350,
      maxPower: 420,
      averageSpeed: 5,
      averageCadence: 90,
      totalElevationGain: 8,
    };
    const parsed = activitySchema.parse({ ...summary, laps: [lap] });

    expect(parsed.laps).toEqual([lap]);
  });

  it("leaves laps absent when none were recorded", () => {
    expect(activitySchema.parse(summary).laps).toBeUndefined();
  });
});

describe("hasLapStructure", () => {
  it("counts only two or more laps as interval structure", () => {
    expect(hasLapStructure(undefined)).toBe(false);
    expect(hasLapStructure([{ index: 1 }])).toBe(false);
    expect(hasLapStructure([{ index: 1 }, { index: 2 }])).toBe(true);
  });
});

describe("cadence unit", () => {
  it("uses steps or strokes per minute for runs, hikes, rows and swims", () => {
    expect(isRunningActivity("trail_running")).toBe(true);
    expect(cadenceUnit("running")).toBe("spm");
    expect(cadenceUnit("hiking")).toBe("spm");
    expect(cadenceUnit("indoor_rowing")).toBe("spm");
    expect(cadenceUnit("swimming")).toBe("spm");
    expect(isRunningActivity("indoor_cycling")).toBe(false);
    expect(cadenceUnit("indoor_cycling")).toBe("rpm");
  });
});

describe("pace and speed", () => {
  it("reads pace for runs, walks, hikes, swims and rows", () => {
    expect(activityUsesPace("running")).toBe(true);
    expect(activityUsesPace("trail_running")).toBe(true);
    expect(activityUsesPace("hiking")).toBe(true);
    expect(activityUsesPace("indoor_rowing")).toBe(true);
    expect(activityUsesPace("indoor_cycling")).toBe(false);
    expect(activityUsesPace("strength_training")).toBe(false);
  });

  it("uses the pace unit the sport normally shows", () => {
    expect(paceUnitMetres("running")).toBe(1000);
    expect(paceUnitLabel("running")).toBe("/km");
    expect(paceUnitMetres("swimming")).toBe(100);
    expect(paceUnitLabel("swimming")).toBe("/100m");
    expect(paceUnitMetres("indoor_rowing")).toBe(500);
    expect(paceUnitLabel("indoor_rowing")).toBe("/500m");
  });

  it("formats pace and speed", () => {
    expect(formatPace(312)).toBe("5:12");
    expect(formatPace(0)).toBe("–");
    expect(formatSpeed(3.3333)).toBe("12.0 km/h");
    expect(formatActivityPaceOrSpeed("running", 1000 / 312)).toBe("5:12 /km");
    expect(formatActivityPaceOrSpeed("indoor_cycling", 1000 / 312)).toBe(
      "11.5 km/h",
    );
    expect(formatActivityPaceOrSpeed("indoor_rowing", 500 / 120)).toBe(
      "2:00 /500m",
    );
  });

  it("derives the average speed from distance and moving time", () => {
    expect(
      activityAverageSpeed({
        distance: 5000,
        movingTime: 1500,
        elapsedTime: 1600,
      }),
    ).toBeCloseTo(3.3333);
    expect(
      activityAverageSpeed({
        distance: 5000,
        movingTime: 1500,
        elapsedTime: 1600,
        averageSpeed: 3,
      }),
    ).toBe(3);
    expect(
      activityAverageSpeed({
        distance: 0,
        movingTime: 0,
        elapsedTime: 600,
      }),
    ).toBeNull();
  });
});

describe("formatActivityType", () => {
  it("turns snake_case activity keys into natural language", () => {
    expect(formatActivityType("indoor_cycling")).toBe("Indoor cycling");
    expect(formatActivityType("strength_training")).toBe("Strength training");
    expect(formatActivityType("running")).toBe("Running");
  });

  it("handles GPS and unknown labels", () => {
    expect(formatActivityType("gps_run")).toBe("GPS run");
    expect(formatActivityType("  ")).toBe("Unknown activity");
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
