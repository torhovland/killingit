import { z } from "zod";

/** The five weather icons the coach UI can render. */
export const weatherIconSchema = z.enum([
  "sun",
  "partly_cloudy",
  "very_cloudy",
  "rain",
  "snow",
]);

export type WeatherIcon = z.infer<typeof weatherIconSchema>;

/** Human-readable labels shared by prompts and accessibility text. */
export const WEATHER_ICON_LABELS: Record<WeatherIcon, string> = {
  sun: "Sunny",
  partly_cloudy: "Partly cloudy",
  very_cloudy: "Very cloudy",
  rain: "Rain",
  snow: "Snow",
};

/** A local 24-hour clock time such as `07:45` or `16:30`. */
const clockTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Expected an HH:MM clock time");

/**
 * One day of forecast for the athlete's location. Named values use SI units:
 * temperatures in °C, wind and gusts in m/s, precipitation in millimetres.
 * Sunrise and sunset are local clock times at the location, or null when the
 * sun does not rise or set (polar day or night). Both are optional so plans
 * stored before daylight planning still parse.
 */
export const dailyWeatherSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date"),
  icon: weatherIconSchema,
  temperatureMaxC: z.number(),
  temperatureMinC: z.number(),
  windMaxMs: z.number().nonnegative(),
  gustMaxMs: z.number().nonnegative(),
  precipitationMm: z.number().nonnegative(),
  sunrise: clockTimeSchema.nullable().optional(),
  sunset: clockTimeSchema.nullable().optional(),
});

export type DailyWeather = z.infer<typeof dailyWeatherSchema>;

/** The three forecast rows the UI can show for one day. */
export const dailyForecastsSchema = z.object({
  openMeteo: dailyWeatherSchema.nullable(),
  yr: dailyWeatherSchema.nullable(),
  combined: dailyWeatherSchema.nullable(),
});

export type DailyForecasts = z.infer<typeof dailyForecastsSchema>;

/** Human-readable names for the forecast sources shown in the plan. */
export const FORECAST_PROVIDER_LABELS: Record<keyof DailyForecasts, string> = {
  combined: "Combined",
  openMeteo: "Open-Meteo",
  yr: "Yr.no",
};

/**
 * One address suggestion returned by the geocoding proxy.
 */
export const geocodedLocationSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country: z.string().nullable().default(null),
  admin1: z.string().nullable().default(null),
});

export type GeocodedLocation = z.infer<typeof geocodedLocationSchema>;

/** Response body of `GET /api/weather/geocode`. */
export const geocodeResponseSchema = z.object({
  results: z.array(geocodedLocationSchema),
});

export type GeocodeResponse = z.infer<typeof geocodeResponseSchema>;

/**
 * The pieces of a forecast line, separated by bullets in the UI. Kept separate
 * so the reader can space the separator without changing the text itself.
 */
export function formatDailyWeatherParts(weather: DailyWeather): string[] {
  const low = Math.round(weather.temperatureMinC);
  const high = Math.round(weather.temperatureMaxC);
  const temperature = low === high ? `${high} °C` : `${low}–${high} °C`;
  const wind = `wind ${Math.round(weather.windMaxMs)} m/s (${Math.round(weather.gustMaxMs)} m/s)`;
  const daylight =
    weather.sunrise != null && weather.sunset != null
      ? `daylight ${weather.sunrise} - ${weather.sunset}`
      : weather.sunrise != null
        ? `sunrise ${weather.sunrise}`
        : weather.sunset != null
          ? `sunset ${weather.sunset}`
          : null;
  return [
    WEATHER_ICON_LABELS[weather.icon],
    temperature,
    wind,
    ...(daylight === null ? [] : [daylight]),
  ];
}

/**
 * Formats one day of weather as a single readable line. The units match the
 * forecast data: °C, m/s, and the location's local clock time. Gusts follow the
 * sustained wind in parentheses, and the daylight window is rendered as a
 * range when both sunrise and sunset are known.
 */
export function formatDailyWeatherLine(weather: DailyWeather): string {
  return formatDailyWeatherParts(weather).join(" · ");
}
