import { describe, expect, it } from "bun:test";
import { dayPlanSchema } from "./plan.js";
import {
  bikeWorkoutSchema,
  hasExportableBikeWorkout,
  type BikeWorkout,
} from "./workout.js";

const workout: BikeWorkout = {
  ftpWatts: 250,
  intervals: [
    { durationSeconds: 600, powerPercent: 55 },
    { durationSeconds: 480, powerPercent: 90 },
    { durationSeconds: 600, powerPercent: 45 },
  ],
};

describe("bikeWorkoutSchema", () => {
  it("accepts intervals with durations and power percentages", () => {
    expect(bikeWorkoutSchema.parse(workout)).toEqual(workout);
  });

  it("rejects empty workouts and non-positive values", () => {
    expect(
      bikeWorkoutSchema.safeParse({ ...workout, intervals: [] }).success,
    ).toBe(false);
    expect(
      bikeWorkoutSchema.safeParse({
        ...workout,
        intervals: [{ durationSeconds: 0, powerPercent: 75 }],
      }).success,
    ).toBe(false);
    expect(
      bikeWorkoutSchema.safeParse({
        ...workout,
        intervals: [{ durationSeconds: 60, powerPercent: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe("dayPlanSchema with a bike workout", () => {
  it("keeps the structured workout on an indoor bike day", () => {
    const parsed = dayPlanSchema.parse({
      date: "2026-10-21",
      type: "workout",
      title: "Sweet spot",
      description: "Indoor trainer ride.",
      durationMinutes: 28,
      intensity: "moderate",
      alternatives: [],
      rationale: "Build threshold power.",
      optional: false,
      status: "planned",
      outdoor: false,
      canBeOutdoor: false,
      bikeWorkout: workout,
    });

    expect(parsed.bikeWorkout).toEqual(workout);
  });

  it("still accepts a day plan without a structured workout", () => {
    const parsed = dayPlanSchema.parse({
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "Conversational pace.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      status: "planned",
    });

    expect(parsed.bikeWorkout).toBeUndefined();
  });
});

describe("hasExportableBikeWorkout", () => {
  it("accepts an indoor bike workout with power targets", () => {
    expect(
      hasExportableBikeWorkout({
        type: "workout",
        outdoor: false,
        bikeWorkout: workout,
      }),
    ).toBe(true);
  });

  it("rejects outdoor sessions, rest days, and sessions without targets", () => {
    expect(
      hasExportableBikeWorkout({
        type: "workout",
        outdoor: true,
        bikeWorkout: workout,
      }),
    ).toBe(false);
    expect(
      hasExportableBikeWorkout({
        type: "workout",
        bikeWorkout: workout,
      }),
    ).toBe(false);
    expect(
      hasExportableBikeWorkout({
        type: "rest",
        outdoor: false,
        bikeWorkout: workout,
      }),
    ).toBe(false);
    expect(hasExportableBikeWorkout({ type: "workout", outdoor: false })).toBe(
      false,
    );
  });
});
