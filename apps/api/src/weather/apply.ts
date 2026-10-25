import type {
  CoachPlan,
  DailyForecasts,
  DailyWeather,
} from "@killingit/shared";
import { forecastsByDate } from "./combine.js";
import type { WeatherForecastSet } from "./forecast.js";

function weatherFor(
  date: string,
  byDate: ReadonlyMap<string, DailyWeather>,
): DailyWeather | null {
  return byDate.get(date) ?? null;
}

function forecastsFor(
  date: string,
  byDate: ReadonlyMap<string, DailyForecasts>,
): DailyForecasts | null {
  return byDate.get(date) ?? null;
}

/**
 * Attaches the forecast day that matches each session to the plan. Weather is
 * attached by the server rather than requested from the model so icons and
 * values come from the forecast. The combined forecast also fills the legacy
 * `weather` field, and each source is stored in `forecasts` for display. A plan
 * without a forecast is returned unchanged.
 */
export function applyForecastToPlan(
  plan: CoachPlan,
  forecast: WeatherForecastSet | null | undefined,
): CoachPlan {
  if (!forecast) {
    return plan;
  }
  const combinedByDate = new Map(
    forecast.combined.map((day) => [day.date, day] as const),
  );
  const sourceByDate = forecastsByDate(
    forecast.openMeteo,
    forecast.yr,
    forecast.combined,
  );
  if (combinedByDate.size === 0) {
    return plan;
  }

  const withWeather = (week: CoachPlan["week"]): CoachPlan["week"] => ({
    ...week,
    sessions: week.sessions.map((session) => ({
      ...session,
      weather: weatherFor(session.date, combinedByDate),
      forecasts: forecastsFor(session.date, sourceByDate),
    })),
  });
  return {
    ...plan,
    week: withWeather(plan.week),
    nextWeek: plan.nextWeek === null ? null : withWeather(plan.nextWeek),
    today: {
      ...plan.today,
      weather: weatherFor(plan.today.date, combinedByDate),
      forecasts: forecastsFor(plan.today.date, sourceByDate),
    },
    tomorrow:
      plan.tomorrow === null
        ? null
        : {
            ...plan.tomorrow,
            weather: weatherFor(plan.tomorrow.date, combinedByDate),
            forecasts: forecastsFor(plan.tomorrow.date, sourceByDate),
          },
  };
}
