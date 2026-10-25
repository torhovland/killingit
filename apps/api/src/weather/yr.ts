import {
  isValidTimeZone,
  type AthleteLocation,
  type DailyWeather,
  type WeatherIcon,
} from "@killingit/shared";
import type { FetchLike } from "./openMeteo.js";

const FORECAST_URL =
  "https://api.met.no/weatherapi/locationforecast/2.0/complete";
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * MET Norway asks every client to identify itself with a contact URL. The
 * repository doubles as the contact point for this app.
 */
export const YR_USER_AGENT =
  "killingit/0.1 (+https://github.com/torhovland/killingit)";

const ICON_SEVERITY: Record<WeatherIcon, number> = {
  sun: 0,
  partly_cloudy: 1,
  very_cloudy: 2,
  rain: 3,
  snow: 4,
};

/**
 * Maps a MET Norway symbol code to one of the five display icons. Symbol codes
 * carry a time-of-day suffix (`_day`, `_night`, `_polartwilight`), so the
 * mapping is based on the leading condition rather than the full string.
 */
export function weatherIconForYrSymbol(symbol: string): WeatherIcon {
  const code = symbol.toLowerCase();
  if (code.startsWith("clearsky")) {
    return "sun";
  }
  if (code.startsWith("fair") || code.startsWith("partlycloudy")) {
    return "partly_cloudy";
  }
  if (code.startsWith("cloudy") || code.startsWith("fog")) {
    return "very_cloudy";
  }
  if (code.includes("snow") || code.includes("sleet")) {
    return "snow";
  }
  if (code.includes("rain")) {
    return "rain";
  }
  return "very_cloudy";
}

function moreSevereIcon(current: WeatherIcon, next: WeatherIcon): WeatherIcon {
  return ICON_SEVERITY[current] >= ICON_SEVERITY[next] ? current : next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function localDate(time: Date, formatter: Intl.DateTimeFormat): string {
  const values = new Map(
    formatter.formatToParts(time).map((part) => [part.type, part.value]),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Yr returned a time that could not be placed on a day");
  }
  return `${year}-${month}-${day}`;
}

interface YrEntry {
  time: Date;
  temperatureC: number;
  windMs: number;
  gustMs: number;
  precipitationMm: number;
  icon: WeatherIcon | null;
}

function precipitations(details: unknown): number | null {
  if (!isRecord(details)) {
    return null;
  }
  const amount = finiteNumber(details.precipitation_amount);
  return amount !== null && amount >= 0 ? amount : null;
}

function symbolCode(summary: unknown): string | null {
  if (!isRecord(summary)) {
    return null;
  }
  return typeof summary.symbol_code === "string" ? summary.symbol_code : null;
}

function parseEntry(value: unknown): YrEntry {
  if (!isRecord(value) || typeof value.time !== "string") {
    throw new Error("Yr returned an unexpected forecast entry");
  }
  const time = new Date(value.time);
  if (Number.isNaN(time.getTime())) {
    throw new Error("Yr returned an invalid forecast time");
  }
  const data = value.data;
  if (!isRecord(data)) {
    throw new Error("Yr returned a forecast entry without data");
  }
  const instant = data.instant;
  const instantDetails = isRecord(instant) ? instant.details : undefined;
  if (!isRecord(instantDetails)) {
    throw new Error("Yr returned a forecast entry without measurements");
  }
  const temperatureC = finiteNumber(instantDetails.air_temperature);
  const windMs = finiteNumber(instantDetails.wind_speed);
  if (temperatureC === null || windMs === null) {
    throw new Error("Yr returned a forecast entry without temperature or wind");
  }
  const gustMs = finiteNumber(instantDetails.wind_speed_of_gust) ?? windMs;

  const nextHour = isRecord(data.next_1_hours) ? data.next_1_hours : null;
  const nextSixHours = isRecord(data.next_6_hours) ? data.next_6_hours : null;
  const nextTwelveHours = isRecord(data.next_12_hours)
    ? data.next_12_hours
    : null;

  // Hourly entries fill in each hour. Longer-range entries are six-hourly and
  // carry the amount for their whole six-hour window.
  const precipitationMm =
    precipitations(nextHour?.details) ??
    precipitations(nextSixHours?.details) ??
    0;

  const symbol =
    symbolCode(nextHour?.summary) ??
    symbolCode(nextSixHours?.summary) ??
    symbolCode(nextTwelveHours?.summary);

  return {
    time,
    temperatureC,
    windMs,
    gustMs,
    precipitationMm,
    icon: symbol === null ? null : weatherIconForYrSymbol(symbol),
  };
}

interface DayAccumulator {
  date: string;
  temperatureMinC: number;
  temperatureMaxC: number;
  windMaxMs: number;
  gustMaxMs: number;
  precipitationMm: number;
  icon: WeatherIcon;
}

/**
 * Parses MET Norway's location forecast into daily weather for the athlete's
 * calendar days. Yr has no daylight times, so the combined forecast takes them
 * from Open-Meteo.
 */
export function parseYrResponse(
  body: unknown,
  timeZone = "UTC",
): DailyWeather[] {
  const properties = isRecord(body) ? body.properties : undefined;
  const timeseries = isRecord(properties) ? properties.timeseries : undefined;
  if (!Array.isArray(timeseries)) {
    throw new Error("Yr returned no forecast");
  }
  const formatter = dateFormatter(isValidTimeZone(timeZone) ? timeZone : "UTC");

  const days = new Map<string, DayAccumulator>();
  for (const rawEntry of timeseries) {
    const entry = parseEntry(rawEntry);
    const date = localDate(entry.time, formatter);
    const current = days.get(date);
    if (current === undefined) {
      days.set(date, {
        date,
        temperatureMinC: entry.temperatureC,
        temperatureMaxC: entry.temperatureC,
        windMaxMs: entry.windMs,
        gustMaxMs: entry.gustMs,
        precipitationMm: entry.precipitationMm,
        icon: entry.icon ?? "very_cloudy",
      });
      continue;
    }
    current.temperatureMinC = Math.min(
      current.temperatureMinC,
      entry.temperatureC,
    );
    current.temperatureMaxC = Math.max(
      current.temperatureMaxC,
      entry.temperatureC,
    );
    current.windMaxMs = Math.max(current.windMaxMs, entry.windMs);
    current.gustMaxMs = Math.max(current.gustMaxMs, entry.gustMs);
    current.precipitationMm += entry.precipitationMm;
    if (entry.icon !== null) {
      current.icon = moreSevereIcon(current.icon, entry.icon);
    }
  }

  return [...days.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => ({
      date: day.date,
      icon: day.icon,
      temperatureMaxC: day.temperatureMaxC,
      temperatureMinC: day.temperatureMinC,
      windMaxMs: day.windMaxMs,
      gustMaxMs: day.gustMaxMs,
      precipitationMm: Math.round(day.precipitationMm * 10) / 10,
    }));
}

/** Loads MET Norway's daily forecast for the athlete's location. */
export async function fetchYrForecast(
  location: AthleteLocation,
  options: {
    fetchImpl?: FetchLike;
    timezone?: string | null;
  } = {},
): Promise<DailyWeather[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(FORECAST_URL);
  url.searchParams.set("lat", String(location.latitude));
  url.searchParams.set("lon", String(location.longitude));

  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": YR_USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Yr returned ${response.status}`);
  }
  return parseYrResponse(await response.json(), options.timezone ?? "UTC");
}
