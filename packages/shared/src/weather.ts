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

/**
 * One day of forecast for the athlete's location. Named values use SI units:
 * temperatures in °C, wind and gusts in m/s, precipitation in millimetres.
 */
export const dailyWeatherSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date"),
  icon: weatherIconSchema,
  temperatureMaxC: z.number(),
  temperatureMinC: z.number(),
  windMaxMs: z.number().nonnegative(),
  gustMaxMs: z.number().nonnegative(),
  precipitationMm: z.number().nonnegative(),
});

export type DailyWeather = z.infer<typeof dailyWeatherSchema>;

/** One address suggestion returned by the geocoding proxy. */
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
