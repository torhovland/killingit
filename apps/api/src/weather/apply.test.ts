import { describe, expect, it } from "bun:test";
import type { CoachPlan, DailyWeather } from "@killingit/shared";
import { addDays } from "../plans/dates.js";
import { applyForecastToPlan } from "./apply.js";
import { combineForecasts } from "./combine.js";
import type { WeatherForecastSet } from "./forecast.js";

const forecast: DailyWeather[] = [
  {
    date: "2026-10-21",
    icon: "rain",
    temperatureMaxC: 9,
    temperatureMinC: 5,
    windMaxMs: 5,
    gustMaxMs: 9,
    precipitationMm: 2,
  },
  {
    date: "2026-10-22",
    icon: "sun",
    temperatureMaxC: 15,
    temperatureMinC: 8,
    windMaxMs: 2,
    gustMaxMs: 4,
    precipitationMm: 0,
  },
];

function forecastSet(
  openMeteo: DailyWeather[],
  yr: DailyWeather[] = [],
): WeatherForecastSet {
  return {
    openMeteo,
    yr,
    combined: combineForecasts(openMeteo, yr),
  };
}

function plan(): CoachPlan {
  return {
    season: {
      goal: "Marathon",
      startDate: "2026-10-21",
      endDate: "2027-04-01",
      rationale: "Build.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-21",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      rationale: "Build.",
      startDate: "2026-10-21",
      endDate: "2026-12-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
        },
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic",
      rationale: "Easy week.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout" as const,
        title: "Easy run",
        description: "Easy.",
        durationMinutes: 45,
        intensity: "easy" as const,
        status: "planned" as const,
      })),
    },
    today: {
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "Easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy.",
      optional: false,
      status: "planned",
    },
    tomorrow: {
      date: "2026-10-22",
      type: "workout",
      title: "Easy run",
      description: "Easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy.",
      optional: false,
      status: "planned",
    },
    nextWeek: null,
    nextBlock: null,
  };
}

describe("applyForecastToPlan", () => {
  it("attaches the matching forecast to sessions, today, and tomorrow", () => {
    const result = applyForecastToPlan(plan(), forecastSet(forecast));

    expect(result.week.sessions[2]?.weather?.icon).toBe("rain");
    expect(result.week.sessions[3]?.weather?.icon).toBe("sun");
    expect(result.week.sessions[0]?.weather).toBeNull();
    expect(result.week.sessions[0]?.forecasts).toBeNull();
    expect(result.today.weather?.icon).toBe("rain");
    expect(result.tomorrow?.weather?.icon).toBe("sun");
  });

  it("stores every provider's forecast alongside the combined values", () => {
    const yr = forecast.map((day) => ({ ...day, icon: "snow" as const }));
    const result = applyForecastToPlan(plan(), forecastSet(forecast, yr));

    const session = result.week.sessions[2];
    expect(session?.weather?.icon).toBe("snow");
    expect(session?.forecasts?.openMeteo?.icon).toBe("rain");
    expect(session?.forecasts?.yr?.icon).toBe("snow");
    expect(session?.forecasts?.combined?.icon).toBe("snow");
  });

  it("attaches the forecast to a stored next week", () => {
    const withNext = plan();
    withNext.nextWeek = {
      ...withNext.week,
      startDate: "2026-10-26",
      sessions: withNext.week.sessions.map((session, index) => ({
        ...session,
        date: addDays("2026-10-26", index),
      })),
    };
    const nextForecast: DailyWeather[] = [
      ...forecast,
      {
        date: "2026-10-26",
        icon: "partly_cloudy",
        temperatureMaxC: 12,
        temperatureMinC: 6,
        windMaxMs: 3,
        gustMaxMs: 5,
        precipitationMm: 0,
      },
    ];

    const result = applyForecastToPlan(withNext, forecastSet(nextForecast));

    expect(result.nextWeek?.sessions[0]?.weather?.icon).toBe("partly_cloudy");
    expect(result.nextWeek?.sessions[1]?.weather).toBeNull();
  });

  it("leaves a plan untouched without a forecast", () => {
    const original = plan();
    expect(applyForecastToPlan(original, null)).toBe(original);
    expect(applyForecastToPlan(original, forecastSet([]))).toBe(original);
  });
});
