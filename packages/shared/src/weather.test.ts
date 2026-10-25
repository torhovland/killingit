import { describe, expect, it } from "bun:test";
import {
  dailyWeatherSchema,
  geocodedLocationSchema,
  WEATHER_ICON_LABELS,
  weatherIconSchema,
} from "./weather.js";

describe("weather schemas", () => {
  it("accepts the five display icons and labels each one", () => {
    for (const icon of [
      "sun",
      "partly_cloudy",
      "very_cloudy",
      "rain",
      "snow",
    ] as const) {
      expect(weatherIconSchema.parse(icon)).toBe(icon);
      expect(WEATHER_ICON_LABELS[icon].length).toBeGreaterThan(0);
    }
    expect(() => weatherIconSchema.parse("hail")).toThrow();
  });

  it("parses a daily forecast with SI units", () => {
    const parsed = dailyWeatherSchema.parse({
      date: "2026-10-25",
      icon: "rain",
      temperatureMaxC: 9.4,
      temperatureMinC: 4.1,
      windMaxMs: 5.2,
      gustMaxMs: 9.8,
      precipitationMm: 3.4,
    });
    expect(parsed.icon).toBe("rain");
    expect(parsed.gustMaxMs).toBe(9.8);
  });

  it("rejects a negative wind speed or a malformed date", () => {
    expect(() =>
      dailyWeatherSchema.parse({
        date: "2026-10-25",
        icon: "sun",
        temperatureMaxC: 12,
        temperatureMinC: 4,
        windMaxMs: -1,
        gustMaxMs: 4,
        precipitationMm: 0,
      }),
    ).toThrow();
    expect(() =>
      dailyWeatherSchema.parse({
        date: "25/10/2026",
        icon: "sun",
        temperatureMaxC: 12,
        temperatureMinC: 4,
        windMaxMs: 1,
        gustMaxMs: 4,
        precipitationMm: 0,
      }),
    ).toThrow();
  });
});

describe("geocodedLocationSchema", () => {
  it("keeps optional administrative fields when present", () => {
    expect(
      geocodedLocationSchema.parse({
        name: "Oslo",
        latitude: 59.91,
        longitude: 10.75,
        country: "Norway",
        admin1: "Oslo",
      }),
    ).toEqual({
      name: "Oslo",
      latitude: 59.91,
      longitude: 10.75,
      country: "Norway",
      admin1: "Oslo",
    });
  });

  it("defaults missing administrative fields to null", () => {
    expect(
      geocodedLocationSchema.parse({
        name: "Oslo",
        latitude: 59.91,
        longitude: 10.75,
      }),
    ).toEqual({
      name: "Oslo",
      latitude: 59.91,
      longitude: 10.75,
      country: null,
      admin1: null,
    });
  });
});
