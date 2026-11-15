import { describe, expect, it } from "bun:test";
import { activityMetadata } from "./activityMetadata";
import { formatDateTime } from "./timeZone";

const ride = {
  startDate: "2026-10-01T06:30:00Z",
  type: "indoor_cycling",
  distance: 25000,
  movingTime: 1500,
  elapsedTime: 1600,
  totalElevationGain: 55,
  averageSpeed: 5,
  averagePower: 210,
  normalizedPower: 230,
};

describe("activityMetadata", () => {
  it("builds every recorded part in display order", () => {
    expect(activityMetadata(ride, "UTC")).toEqual([
      formatDateTime(ride.startDate, "UTC"),
      "Indoor cycling",
      "25.00 km",
      "18.0 km/h",
      "26:40",
      "55 m climb",
      "210 W average",
      "230 W normalized",
    ]);
  });

  it("reads the start time in the athlete's zone", () => {
    const zone = "America/New_York";

    expect(activityMetadata(ride, zone)[0]).toBe(
      formatDateTime(ride.startDate, zone),
    );
  });

  it("shows pace and derives it when the source recorded no speed", () => {
    const metadata = activityMetadata(
      {
        ...ride,
        type: "running",
        distance: 5000,
        movingTime: 1500,
        elapsedTime: 1600,
        totalElevationGain: 0,
        averageSpeed: null,
        averagePower: undefined,
        normalizedPower: undefined,
      },
      "UTC",
    );

    expect(metadata).toEqual([
      formatDateTime(ride.startDate, "UTC"),
      "Running",
      "5.00 km",
      "5:00 /km",
      "26:40",
    ]);
  });

  it("keeps only the date, type and duration when they are all it has", () => {
    const metadata = activityMetadata(
      {
        startDate: ride.startDate,
        type: "strength_training",
        distance: 0,
        movingTime: 0,
        elapsedTime: 95,
        totalElevationGain: 0,
      },
      "UTC",
    );

    expect(metadata).toEqual([
      formatDateTime(ride.startDate, "UTC"),
      "Strength training",
      "1:35",
    ]);
  });

  it("omits zero power readings", () => {
    const metadata = activityMetadata(
      {
        ...ride,
        averagePower: 0,
        normalizedPower: 0,
      },
      "UTC",
    );

    expect(metadata).not.toContain("0 W average");
    expect(metadata).not.toContain("0 W normalized");
  });

  it("includes only the power readings that were recorded", () => {
    const metadata = activityMetadata(
      { ...ride, normalizedPower: undefined },
      "UTC",
    );

    expect(metadata).toContain("210 W average");
    expect(metadata).not.toContain("230 W normalized");
  });
});
