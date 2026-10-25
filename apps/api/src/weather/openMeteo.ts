import type {
  AthleteLocation,
  DailyWeather,
  GeocodedLocation,
  WeatherIcon,
} from "@killingit/shared";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REQUEST_TIMEOUT_MS = 8_000;
const FORECAST_DAYS = 16;
const GEOCODE_RESULTS = 5;

/**
 * The part of `fetch` this module uses. Kept narrow so tests can supply a
 * plain function instead of a full Bun `fetch` with its extra properties.
 */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Maps a WMO weather code from Open-Meteo to one of the five icons the UI
 * supports. Unknown codes are treated as very cloudy rather than failing the
 * forecast.
 */
export function weatherIconForCode(code: number): WeatherIcon {
  if (code <= 1) {
    return "sun";
  }
  if (code === 2) {
    return "partly_cloudy";
  }
  if (code === 3 || code === 45 || code === 48) {
    return "very_cloudy";
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return "rain";
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return "snow";
  }
  if (code >= 95 && code <= 99) {
    return "rain";
  }
  return "very_cloudy";
}

/**
 * Open-Meteo pads the end of the requested range with `null` once it runs out
 * of forecast data, so a missing value is allowed here and the incomplete day
 * is skipped later.
 */
function asNumberArray(value: unknown): (number | null)[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: unknown[] = value;
  const numbers: (number | null)[] = [];
  for (const entry of entries) {
    if (entry === null) {
      numbers.push(null);
      continue;
    }
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return null;
    }
    numbers.push(entry);
  }
  return numbers;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: unknown[] = value;
  const strings: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      return null;
    }
    strings.push(entry);
  }
  return strings;
}

/** Like `asStringArray`, but Open-Meteo returns null for polar day and night. */
function asNullableStringArray(value: unknown): (string | null)[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: unknown[] = value;
  const strings: (string | null)[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry === "string") {
      strings.push(entry);
      continue;
    }
    return null;
  }
  return strings;
}

/**
 * Open-Meteo returns sunrise and sunset as local ISO date-times such as
 * `2026-10-25T07:42`. The plan only needs the clock time, so the date and any
 * offset are dropped.
 */
function localClockTime(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const match =
    /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (match?.[1] === undefined) {
    throw new Error("Weather service returned an invalid daylight time");
  }
  return match[1];
}

/**
 * Parses Open-Meteo's daily forecast response. The arrays are validated as a
 * set so a partial or malformed response fails loudly instead of producing
 * forecast days with invented values.
 */
export function parseForecastResponse(body: unknown): DailyWeather[] {
  const daily =
    typeof body === "object" && body !== null
      ? (body as { daily?: unknown }).daily
      : undefined;
  if (typeof daily !== "object" || daily === null) {
    throw new Error("Weather service returned no daily forecast");
  }

  const fields = daily as Record<string, unknown>;
  const dates = asStringArray(fields.time);
  const codes = asNumberArray(fields.weather_code);
  const maxTemperatures = asNumberArray(fields.temperature_2m_max);
  const minTemperatures = asNumberArray(fields.temperature_2m_min);
  const windSpeeds = asNumberArray(fields.wind_speed_10m_max);
  const windGusts = asNumberArray(fields.wind_gusts_10m_max);
  const precipitation = asNumberArray(fields.precipitation_sum);
  const sunrises = asNullableStringArray(fields.sunrise);
  const sunsets = asNullableStringArray(fields.sunset);
  if (
    !dates ||
    !codes ||
    !maxTemperatures ||
    !minTemperatures ||
    !windSpeeds ||
    !windGusts ||
    !precipitation ||
    !sunrises ||
    !sunsets ||
    dates.length !== codes.length ||
    dates.length !== maxTemperatures.length ||
    dates.length !== minTemperatures.length ||
    dates.length !== windSpeeds.length ||
    dates.length !== windGusts.length ||
    dates.length !== precipitation.length ||
    dates.length !== sunrises.length ||
    dates.length !== sunsets.length
  ) {
    throw new Error("Weather service returned an unexpected forecast shape");
  }

  const days: DailyWeather[] = [];
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const code = codes[index];
    const temperatureMaxC = maxTemperatures[index];
    const temperatureMinC = minTemperatures[index];
    const windMaxMs = windSpeeds[index];
    const gustMaxMs = windGusts[index];
    const precipitationMm = precipitation[index];
    const sunrise = localClockTime(sunrises[index] ?? null);
    const sunset = localClockTime(sunsets[index] ?? null);
    if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Weather service returned an invalid forecast date");
    }
    // Drop days the service has not filled in yet. The preceding days are
    // still useful, and the plan simply has no weather for the missing dates.
    if (
      code === null ||
      code === undefined ||
      temperatureMaxC === null ||
      temperatureMaxC === undefined ||
      temperatureMinC === null ||
      temperatureMinC === undefined ||
      windMaxMs === null ||
      windMaxMs === undefined ||
      gustMaxMs === null ||
      gustMaxMs === undefined ||
      precipitationMm === null ||
      precipitationMm === undefined
    ) {
      continue;
    }
    days.push({
      date,
      icon: weatherIconForCode(code),
      temperatureMaxC,
      temperatureMinC,
      windMaxMs,
      gustMaxMs,
      precipitationMm,
      sunrise,
      sunset,
    });
  }
  return days;
}

/**
 * Loads up to 16 daily forecast days for the athlete's location. Open-Meteo
 * interprets dates in the location's time zone, so the returned dates line up
 * with the athlete's calendar days.
 */
export async function fetchWeatherForecast(
  location: AthleteLocation,
  options: { fetchImpl?: FetchLike } = {},
): Promise<DailyWeather[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "precipitation_sum",
      "sunrise",
      "sunset",
    ].join(","),
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));

  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Weather service returned ${response.status}`);
  }
  return parseForecastResponse(await response.json());
}

function geocodedLocation(value: unknown): GeocodedLocation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.name !== "string" ||
    entry.name.trim() === "" ||
    typeof entry.latitude !== "number" ||
    !Number.isFinite(entry.latitude) ||
    entry.latitude < -90 ||
    entry.latitude > 90 ||
    typeof entry.longitude !== "number" ||
    !Number.isFinite(entry.longitude) ||
    entry.longitude < -180 ||
    entry.longitude > 180
  ) {
    return null;
  }
  return {
    name: entry.name,
    latitude: entry.latitude,
    longitude: entry.longitude,
    country: typeof entry.country === "string" ? entry.country : null,
    admin1: typeof entry.admin1 === "string" ? entry.admin1 : null,
  };
}

/** Parses the geocoding response, ignoring malformed suggestions. */
export function parseGeocodeResponse(body: unknown): GeocodedLocation[] {
  const results =
    typeof body === "object" && body !== null
      ? (body as { results?: unknown }).results
      : undefined;
  if (!Array.isArray(results)) {
    return [];
  }
  return results
    .map(geocodedLocation)
    .filter((entry): entry is GeocodedLocation => entry !== null);
}

/** Looks up addresses with the Open-Meteo geocoding service. */
export async function searchLocations(
  query: string,
  fetcher: FetchLike = fetch,
): Promise<GeocodedLocation[]> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("name", query.trim());
  url.searchParams.set("count", String(GEOCODE_RESULTS));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetcher(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Geocoding service returned ${response.status}`);
  }
  return parseGeocodeResponse(await response.json());
}
