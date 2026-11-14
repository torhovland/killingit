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

/** One cached forecast set and the terms under which it may be reused. */
export interface WeatherForecastCacheEntry {
  forecast: WeatherForecastSet;
  /** No provider is asked again before this epoch-millisecond time. */
  expiresAt: number;
  /** Yr's `Last-Modified`, replayed as `If-Modified-Since` when revalidating. */
  yrLastModified: string | null;
}

export interface WeatherForecastOptions {
  fetchImpl?: FetchLike;
  /** The athlete's IANA time zone, used to put Yr's UTC times on local days. */
  timezone?: string | null;
  /** Test seam: the cache store. Production uses one process-wide store. */
  cache?: Map<string, WeatherForecastCacheEntry>;
  /** Test seam: the clock in epoch milliseconds. Production uses `Date.now`. */
  now?: () => number;
}

/**
 * A good forecast is reused for an hour. Plan polls arrive every few seconds
 * while the coach generates, and Yr.no's terms ask clients to cache instead of
 * asking again for every request.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * Coordinates are cached to 0.01°, roughly a kilometre, so nearby requests
 * share an entry while a forecast stays local to the athlete.
 */
const COORDINATE_ROUNDING_FACTOR = 100;

/** Process-wide cache, keyed by rounded location and effective time zone. */
const forecastCache = new Map<string, WeatherForecastCacheEntry>();

function resolveTimeZone(timezone: string | null | undefined): string {
  return timezone != null && isValidTimeZone(timezone) ? timezone : "UTC";
}

function rounded(value: number): number {
  return (
    Math.round(value * COORDINATE_ROUNDING_FACTOR) / COORDINATE_ROUNDING_FACTOR
  );
}

/**
 * Cache key from the rounded coordinates and the time zone the days are
 * bucketed in. The location's display name does not affect the forecast.
 */
function cacheKey(location: AthleteLocation, timezone: string): string {
  return `${String(rounded(location.latitude))},${String(rounded(location.longitude))}|${timezone}`;
}

function cachedDays(
  cached: WeatherForecastCacheEntry | undefined,
  provider: "openMeteo" | "yr",
): DailyWeather[] {
  return cached === undefined ? [] : cached.forecast[provider];
}

/** Stores an entry and drops older ones so the cache cannot grow unbounded. */
function rememberForecast(
  cache: Map<string, WeatherForecastCacheEntry>,
  key: string,
  entry: WeatherForecastCacheEntry,
  now: number,
): void {
  for (const [cachedKey, cachedEntry] of cache) {
    if (cachedEntry.expiresAt <= now) {
      cache.delete(cachedKey);
    }
  }
  cache.set(key, entry);
}

/**
 * Loads the same daily forecast from Open-Meteo and Yr.no, then averages the
 * numbers into a combined forecast. The two providers are independent: if one
 * is down, the other still supplies a forecast and the combined row falls back
 * to it. The caller decides whether a total failure should suppress weather.
 *
 * A good result is cached for the rounded location and time zone, and Yr is
 * revalidated with `If-Modified-Since` so an unchanged forecast costs a 304.
 * A failed refresh keeps the rows already cached, so an outage mid-season does
 * not blank the weather; only a failure with nothing cached throws.
 */
export async function fetchWeatherForecasts(
  location: AthleteLocation,
  options: WeatherForecastOptions = {},
): Promise<WeatherForecastSet> {
  const timezone = resolveTimeZone(options.timezone);
  const now = (options.now ?? Date.now)();
  const cache = options.cache ?? forecastCache;
  const key = cacheKey(location, timezone);
  const cached = cache.get(key);
  if (cached !== undefined && now < cached.expiresAt) {
    return cached.forecast;
  }

  const commonOptions =
    options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {};
  const [openMeteoResult, yrResult] = await Promise.allSettled([
    fetchWeatherForecast(location, { timezone, ...commonOptions }),
    fetchYrForecast(location, {
      timezone,
      ...commonOptions,
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(cached?.yrLastModified != null
        ? { ifModifiedSince: cached.yrLastModified }
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
    openMeteoResult.status === "fulfilled"
      ? openMeteoResult.value
      : cachedDays(cached, "openMeteo");

  let yr: DailyWeather[];
  let yrExpiresAt: number | null = null;
  let yrLastModified = cached?.yrLastModified ?? null;
  if (yrResult.status === "rejected") {
    yr = cachedDays(cached, "yr");
  } else {
    yrExpiresAt = yrResult.value.expiresAt;
    yrLastModified = yrResult.value.lastModified ?? yrLastModified;
    yr = yrResult.value.notModified
      ? cachedDays(cached, "yr")
      : yrResult.value.days;
  }

  if (openMeteo.length === 0 && yr.length === 0) {
    throw new Error("No weather forecast was available");
  }

  const forecast: WeatherForecastSet = {
    openMeteo,
    yr,
    combined: combineForecasts(openMeteo, yr),
  };
  rememberForecast(
    cache,
    key,
    {
      forecast,
      // Yr may ask for a longer window than the TTL; never ask sooner.
      expiresAt: Math.max(now + CACHE_TTL_MS, yrExpiresAt ?? 0),
      yrLastModified,
    },
    now,
  );
  return forecast;
}
