import { describe, expect, it } from "bun:test";
import type { DailyWeather } from "@killingit/shared";
import { combineForecasts } from "./combine.js";

function weather(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    date: "2026-10-25",
    icon: "sun",
    temperatureMaxC: 10,
    temperatureMinC: 4,
    windMaxMs: 4,
    gustMaxMs: 8,
    precipitationMm: 0,
    sunrise: "07:35",
    sunset: "16:28",
    ...overrides,
  };
}

describe("combineForecasts", () => {
  it("averages numbers and keeps Open-Meteo's daylight", () => {
    const meteo = weather({
      date: "2026-10-25",
      icon: "sun",
      temperatureMaxC: 10,
      temperatureMinC: 4,
      windMaxMs: 4,
      gustMaxMs: 8,
      precipitationMm: 0,
    });
    const yr = weather({
      date: "2026-10-25",
      icon: "rain",
      temperatureMaxC: 12,
      temperatureMinC: 6,
      windMaxMs: 6,
      gustMaxMs: 10,
      precipitationMm: 2,
      sunrise: undefined,
      sunset: undefined,
    });

    const combined = combineForecasts([meteo], [yr]);

    expect(combined).toEqual([
      {
        date: "2026-10-25",
        icon: "rain",
        temperatureMaxC: 11,
        temperatureMinC: 5,
        windMaxMs: 5,
        gustMaxMs: 9,
        precipitationMm: 1,
        sunrise: "07:35",
        sunset: "16:28",
      },
    ]);
  });

  it("picks the more severe weather type when the providers disagree", () => {
    const combined = combineForecasts(
      [weather({ icon: "very_cloudy" })],
      [weather({ icon: "snow" })],
    );

    expect(combined[0]?.icon).toBe("snow");
  });

  it("uses a single provider for dates the other does not cover", () => {
    const combined = combineForecasts(
      [weather({ date: "2026-10-25" })],
      [weather({ date: "2026-10-26", icon: "rain" })],
    );

    expect(combined.map((day) => [day.date, day.icon])).toEqual([
      ["2026-10-25", "sun"],
      ["2026-10-26", "rain"],
    ]);
  });

  it("sorts dates and skips days without data", () => {
    const combined = combineForecasts(
      [weather({ date: "2026-10-26" }), weather({ date: "2026-10-24" })],
      [],
    );

    expect(combined.map((day) => day.date)).toEqual([
      "2026-10-24",
      "2026-10-26",
    ]);
  });
});
