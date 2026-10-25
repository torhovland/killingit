import { describe, expect, it } from "bun:test";
import type {
  CoachPlan,
  DailyWeather,
  WeekPlan,
  WeekSession,
} from "@killingit/shared";
import { planWeatherChanged, weatherChangedSignificantly } from "./changes.js";

function weather(
  date: string,
  overrides: Partial<DailyWeather> = {},
): DailyWeather {
  return {
    date,
    icon: "sun",
    temperatureMaxC: 15,
    temperatureMinC: 7,
    windMaxMs: 3,
    gustMaxMs: 5,
    precipitationMm: 0,
    ...overrides,
  };
}

function session(
  date: string,
  overrides: Partial<WeekSession> = {},
): WeekSession {
  return {
    date,
    day: "Monday",
    type: "workout",
    title: "Easy run",
    description: "Easy.",
    durationMinutes: 45,
    intensity: "easy",
    status: "planned",
    ...overrides,
  };
}

function week(startDate: string, sessions?: WeekSession[]): WeekPlan {
  return {
    startDate,
    focus: "Aerobic",
    rationale: "Keep it easy.",
    sessions:
      sessions ??
      Array.from({ length: 7 }, (_, index) =>
        session(`2026-10-${String(19 + index)}`),
      ),
  };
}

function plan(overrides: Partial<CoachPlan> = {}): CoachPlan {
  return {
    season: {
      goal: "Marathon",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      rationale: "Build.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-19",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      startDate: "2026-10-19",
      endDate: "2026-12-01",
      rationale: "Build.",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
        },
      ],
    },
    week: week("2026-10-19"),
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
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    ...overrides,
  };
}

function withForecast(
  weekPlan: WeekPlan,
  forecast: readonly DailyWeather[],
): WeekPlan {
  const byDate = new Map(forecast.map((day) => [day.date, day]));
  return {
    ...weekPlan,
    sessions: weekPlan.sessions.map((entry) => ({
      ...entry,
      weather: byDate.get(entry.date) ?? null,
    })),
  };
}

function forecastForWeek(icon: DailyWeather["icon"]): DailyWeather[] {
  return Array.from({ length: 7 }, (_, index) =>
    weather(`2026-10-${String(19 + index)}`, { icon }),
  );
}

const NEXT_WEEK_DATES = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
];

describe("weatherChangedSignificantly", () => {
  it("ignores small changes to a dry day", () => {
    expect(
      weatherChangedSignificantly(
        weather("2026-10-21", { icon: "sun" }),
        weather("2026-10-21", {
          icon: "partly_cloudy",
          temperatureMaxC: 17,
          windMaxMs: 4,
          gustMaxMs: 6,
          precipitationMm: 1,
        }),
      ),
    ).toBe(false);
  });

  it("treats a new forecast or a wet day as a change", () => {
    expect(weatherChangedSignificantly(null, weather("2026-10-21"))).toBe(true);
    expect(
      weatherChangedSignificantly(
        weather("2026-10-21", { icon: "sun" }),
        weather("2026-10-21", { icon: "rain", precipitationMm: 1 }),
      ),
    ).toBe(true);
    expect(
      weatherChangedSignificantly(
        weather("2026-10-21", { icon: "rain", precipitationMm: 2 }),
        weather("2026-10-21", { icon: "snow", precipitationMm: 2 }),
      ),
    ).toBe(true);
  });

  it("detects significant temperature, wind, gust, and rain changes", () => {
    const base = weather("2026-10-21");
    expect(
      weatherChangedSignificantly(base, { ...base, temperatureMaxC: 20 }),
    ).toBe(true);
    expect(weatherChangedSignificantly(base, { ...base, windMaxMs: 8 })).toBe(
      true,
    );
    expect(weatherChangedSignificantly(base, { ...base, gustMaxMs: 13 })).toBe(
      true,
    );
    expect(
      weatherChangedSignificantly(base, { ...base, precipitationMm: 5 }),
    ).toBe(true);
  });

  it("does not treat a cloud-only icon change as significant", () => {
    expect(
      weatherChangedSignificantly(
        weather("2026-10-21", { icon: "sun" }),
        weather("2026-10-21", { icon: "very_cloudy" }),
      ),
    ).toBe(false);
  });
});

describe("planWeatherChanged", () => {
  it("marks the week when an upcoming outdoor session changes", () => {
    const stored = plan({
      week: withForecast(week("2026-10-19"), forecastForWeek("sun")),
    });
    const next = forecastForWeek("sun");
    const friday = next[4];
    if (friday === undefined) {
      throw new Error("missing test forecast day");
    }
    next[4] = { ...friday, icon: "rain", precipitationMm: 4 };

    expect(planWeatherChanged(stored, next, "2026-10-21")).toBe(true);
  });

  it("ignores forecast changes on past days", () => {
    const stored = plan({
      week: withForecast(week("2026-10-19"), forecastForWeek("sun")),
    });
    const next = forecastForWeek("sun").map((day) => {
      if (day.date < "2026-10-21") {
        return { ...day, icon: "rain" as const, precipitationMm: 9 };
      }
      return day;
    });

    expect(planWeatherChanged(stored, next, "2026-10-21")).toBe(false);
  });

  it("includes a rest day so better weather can make it an outdoor day", () => {
    const sessions = [
      session("2026-10-19"),
      session("2026-10-20"),
      session("2026-10-21"),
      session("2026-10-22", { type: "rest", intensity: "rest" }),
      session("2026-10-23"),
      session("2026-10-24"),
      session("2026-10-25"),
    ];
    const stored = plan({
      week: withForecast(week("2026-10-19", sessions), forecastForWeek("rain")),
    });
    const next = forecastForWeek("rain");
    const restDay = next[3];
    if (restDay === undefined) {
      throw new Error("missing test forecast day");
    }
    next[3] = { ...restDay, icon: "sun", precipitationMm: 0 };

    expect(planWeatherChanged(stored, next, "2026-10-21")).toBe(true);
  });

  it("includes an indoor session so better weather can make it outdoor", () => {
    const sessions = [
      session("2026-10-19"),
      session("2026-10-20"),
      session("2026-10-21"),
      session("2026-10-22"),
      session("2026-10-23", { outdoor: false }),
      session("2026-10-24"),
      session("2026-10-25"),
    ];
    const stored = plan({
      week: withForecast(week("2026-10-19", sessions), forecastForWeek("rain")),
    });
    const next = forecastForWeek("rain");
    const indoorDay = next[4];
    if (indoorDay === undefined) {
      throw new Error("missing test forecast day");
    }
    next[4] = { ...indoorDay, icon: "sun", precipitationMm: 0 };

    expect(planWeatherChanged(stored, next, "2026-10-21")).toBe(true);
  });

  it("ignores a date that has no current forecast", () => {
    const forecast = forecastForWeek("sun").slice(0, 3);
    const stored = plan({
      week: withForecast(week("2026-10-19"), forecastForWeek("sun")),
    });

    expect(planWeatherChanged(stored, forecast, "2026-10-21")).toBe(false);
  });

  it("includes the next week that the Week tab shows", () => {
    const nextWeekForecast = NEXT_WEEK_DATES.map((date) =>
      weather(date, { icon: "sun" }),
    );
    const nextWeek = withForecast(
      week(
        "2026-10-26",
        NEXT_WEEK_DATES.map((date) => session(date)),
      ),
      nextWeekForecast,
    );
    const stored = plan({
      week: withForecast(week("2026-10-19"), forecastForWeek("sun")),
      nextWeek,
    });
    const next = [...forecastForWeek("sun"), ...nextWeekForecast];
    const monday = next[7];
    if (monday === undefined) {
      throw new Error("missing test forecast day");
    }
    next[7] = { ...monday, icon: "rain", precipitationMm: 5 };

    expect(planWeatherChanged(stored, next, "2026-10-21")).toBe(true);
  });

  it("is not a change when the stored and current forecasts agree", () => {
    const forecast = forecastForWeek("sun");
    const stored = plan({ week: withForecast(week("2026-10-19"), forecast) });

    expect(planWeatherChanged(stored, forecast, "2026-10-21")).toBe(false);
  });
});
