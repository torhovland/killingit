import { describe, expect, it, spyOn } from "bun:test";
import type { AthleteLocation } from "@killingit/shared";
import { loadPlanInputs, type PlanInputDependencies } from "./planInputs.js";
import type { WeatherForecastSet } from "../weather/forecast.js";

const today = "2026-11-12";
const location: AthleteLocation = {
  latitude: 59.91,
  longitude: 10.75,
  name: "Oslo",
};

const forecast: WeatherForecastSet = {
  openMeteo: [],
  yr: [],
  combined: [
    {
      date: today,
      icon: "sun",
      temperatureMaxC: 4,
      temperatureMinC: -2,
      windMaxMs: 2,
      gustMaxMs: 4,
      precipitationMm: 0,
    },
  ],
};

/** Every advisory loader in memory, so no test reaches the database. */
function dependencies(
  overrides: Partial<PlanInputDependencies> = {},
): PlanInputDependencies {
  return {
    loadEvents: () => Promise.resolve([]),
    loadDiet: () => Promise.resolve(null),
    loadDayCalories: () => Promise.resolve(new Map()),
    loadThresholdHistory: () =>
      Promise.resolve({ points: [], timelines: [], summaries: [] }),
    loadBodyHistory: () => Promise.resolve({ weight: [], bodyFat: [] }),
    loadDailyHealth: () => Promise.resolve([]),
    loadForecast: () => Promise.resolve(forecast),
    ...overrides,
  };
}

describe("loadPlanInputs", () => {
  it("reads the calorie and health windows the prompt asks for", async () => {
    const calorieWindows: [string, string][] = [];
    const healthWindows: [string, string][] = [];
    const deps = dependencies({
      loadDayCalories: (_userId, fromDate, toDate) => {
        calorieWindows.push([fromDate, toDate]);
        return Promise.resolve(
          new Map([
            ["2026-11-10", 2400],
            ["2026-11-12", 2600],
          ]),
        );
      },
      loadDailyHealth: (_userId, fromDate, toDate) => {
        healthWindows.push([fromDate, toDate]);
        return Promise.resolve([]);
      },
    });

    const inputs = await loadPlanInputs(deps, {
      userId: 242,
      today,
      location,
      timeZone: "Europe/Oslo",
    });

    expect(calorieWindows).toEqual([["2026-10-15", today]]);
    expect(healthWindows).toEqual([["2026-10-01", today]]);
    expect(inputs.calorieHistory).toEqual([
      { date: "2026-11-12", caloriesKcal: 2600 },
      { date: "2026-11-10", caloriesKcal: 2400 },
    ]);
  });

  it("returns the loaded inputs in the shape the context reads", async () => {
    const thresholds = {
      points: [],
      timelines: [],
      summaries: [],
    };
    const body = { weight: [], bodyFat: [] };
    const diet = { meals: [], weeks: [] };
    const events = [
      { startDate: today, endDate: null, title: "Race", kind: "race" as const },
    ];
    const deps = dependencies({
      loadEvents: () => Promise.resolve(events),
      loadDiet: () => Promise.resolve(diet),
      loadThresholdHistory: () => Promise.resolve(thresholds),
      loadBodyHistory: () => Promise.resolve(body),
    });

    const inputs = await loadPlanInputs(deps, {
      userId: 242,
      today,
      location,
      timeZone: "Europe/Oslo",
    });

    expect(inputs.events).toBe(events);
    expect(inputs.diet).toBe(diet);
    expect(inputs.thresholdHistory).toBe(thresholds);
    expect(inputs.bodyHistory).toBe(body);
    expect(inputs.dailyHealth).toEqual([]);
    expect(inputs.weatherForecasts).toBe(forecast);
    expect(inputs.forecast).toBe(forecast.combined);
  });

  it("passes the athlete's location and zone to the forecast loader", async () => {
    const calls: [AthleteLocation, string | null][] = [];
    const deps = dependencies({
      loadForecast: (entry, timeZone) => {
        calls.push([entry, timeZone]);
        return Promise.resolve(forecast);
      },
    });

    await loadPlanInputs(deps, {
      userId: 242,
      today,
      location,
      timeZone: "Europe/Oslo",
    });

    expect(calls).toEqual([[location, "Europe/Oslo"]]);
  });

  it("reads no forecast when the athlete has no location", async () => {
    let reads = 0;
    const deps = dependencies({
      loadForecast: () => {
        reads += 1;
        return Promise.resolve(forecast);
      },
    });

    const inputs = await loadPlanInputs(deps, {
      userId: 242,
      today,
      location: null,
      timeZone: null,
    });

    expect(reads).toBe(0);
    expect(inputs.weatherForecasts).toBeNull();
    expect(inputs.forecast).toBeNull();
  });

  it("plans without an advisory input whose read fails", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const deps = dependencies({
      loadEvents: () => Promise.reject(new Error("events down")),
      loadDiet: () => Promise.reject(new Error("diet down")),
      loadDayCalories: () => Promise.reject(new Error("calories down")),
      loadThresholdHistory: () => Promise.reject(new Error("thresholds down")),
      loadBodyHistory: () => Promise.reject(new Error("body down")),
      loadDailyHealth: () => Promise.reject(new Error("health down")),
      loadForecast: () => Promise.reject(new Error("forecast down")),
    });

    try {
      const inputs = await loadPlanInputs(deps, {
        userId: 242,
        today,
        location,
        timeZone: "Europe/Oslo",
      });

      expect(inputs.events).toEqual([]);
      expect(inputs.diet).toBeNull();
      expect(inputs.calorieHistory).toBeUndefined();
      expect(inputs.thresholdHistory).toEqual({
        points: [],
        timelines: [],
        summaries: [],
      });
      expect(inputs.bodyHistory).toEqual({ weight: [], bodyFat: [] });
      expect(inputs.dailyHealth).toBeUndefined();
      expect(inputs.weatherForecasts).toBeNull();
      expect(inputs.forecast).toBeNull();
      expect(
        log.mock.calls.some((call) =>
          String(call[0]).includes("could not read the threshold history"),
        ),
      ).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("reports an empty forecast as absent", async () => {
    const deps = dependencies({
      loadForecast: () =>
        Promise.resolve({ openMeteo: [], yr: [], combined: [] }),
    });

    const inputs = await loadPlanInputs(deps, {
      userId: 242,
      today,
      location,
      timeZone: null,
    });

    expect(inputs.weatherForecasts).toEqual({
      openMeteo: [],
      yr: [],
      combined: [],
    });
    expect(inputs.forecast).toBeNull();
  });
});
