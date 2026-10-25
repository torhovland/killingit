import {
  isValidTimeZone,
  type AthleteLocation,
  type DailyWeather,
} from "@killingit/shared";
import { combineForecasts } from "./combine.js";
import { fetchWeatherForecast, type FetchLike } from "./openMeteo.js";
import { fetchYrForecast } from "./yr.js";

export interface WeatherForecastSet {
  /** Open-Meteo's forecast, or an empty list when it was unavailable. */
  openMeteo: DailyWeather[];
  /** MET Norway (Yr.no)'s forecast, or an empty list when unavailable. */
  yr: DailyWeather[];
  /** The average of both providers; one provider alone when the other fails. */
  combined: DailyWeather[];
}

export interface WeatherForecastOptions {
  fetchImpl?: FetchLike;
  /** The athlete's IANA time zone, used to put Yr's UTC times on local days. */
  timezone?: string | null;
}

function resolveTimeZone(timezone: string | null | undefined): string {
  return timezone != null && isValidTimeZone(timezone) ? timezone : "UTC";
}

/**
 * Loads the same daily forecast from Open-Meteo and Yr.no, then averages the
 * numbers into a combined forecast. The two providers are independent: if one
 * is down, the other still supplies a forecast and the combined row falls back
 * to it. The caller decides whether a total failure should suppress weather.
 */
export async function fetchWeatherForecasts(
  location: AthleteLocation,
  options: WeatherForecastOptions = {},
): Promise<WeatherForecastSet> {
  const timezone = resolveTimeZone(options.timezone);
  const [openMeteoResult, yrResult] = await Promise.allSettled([
    fetchWeatherForecast(location, {
      timezone,
      ...(options.fetchImpl !== undefined
        ? { fetchImpl: options.fetchImpl }
        : {}),
    }),
    fetchYrForecast(location, {
      timezone,
      ...(options.fetchImpl !== undefined
        ? { fetchImpl: options.fetchImpl }
        : {}),
    }),
  ]);

  if (openMeteoResult.status === "rejected") {
    console.error(
      "[weather] Open-Meteo forecast failed:",
      openMeteoResult.reason,
    );
  }
  if (yrResult.status === "rejected") {
    console.error("[weather] Yr forecast failed:", yrResult.reason);
  }

  const openMeteo =
    openMeteoResult.status === "fulfilled" ? openMeteoResult.value : [];
  const yr = yrResult.status === "fulfilled" ? yrResult.value : [];
  if (openMeteo.length === 0 && yr.length === 0) {
    throw new Error("No weather forecast was available");
  }

  return {
    openMeteo,
    yr,
    combined: combineForecasts(openMeteo, yr),
  };
}
