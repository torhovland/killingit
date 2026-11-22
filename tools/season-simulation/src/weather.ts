import type { DailyWeather } from "@killingit/shared";
import type { WeatherForecastSet } from "../../../apps/api/src/weather/forecast.js";
import { addDays } from "@killingit/shared";

/**
 * A deterministic Trondheim-like forecast. Open-Meteo and Yr.no only serve a
 * short horizon, so the season is planned against a seasonal approximation
 * instead of a real network call: cold, dark winters and long summer days.
 */
export function syntheticForecast(
  today: string,
  days: number,
): WeatherForecastSet {
  const combined = Array.from({ length: days }, (_, index) =>
    dayForecast(addDays(today, index)),
  );
  return { openMeteo: combined, yr: combined, combined };
}

function dayForecast(date: string): DailyWeather {
  const dayOfYear = dayOffset(date);
  const mean = 7 + 8 * Math.sin((2 * Math.PI * (dayOfYear - 105)) / 365);
  const wet = (dayOfYear * 37) % 11;
  const temperatureMinC = round(mean - 4);
  const temperatureMaxC = round(mean + 4);
  const precipitationMm = wet < 3 ? 0 : round(wet * 0.6);
  const icon: DailyWeather["icon"] =
    temperatureMaxC < 1 && precipitationMm > 0
      ? "snow"
      : precipitationMm > 2
        ? "rain"
        : wet % 3 === 0
          ? "sun"
          : wet % 3 === 1
            ? "partly_cloudy"
            : "very_cloudy";
  const daylight = 12.5 + 8 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365);
  return {
    date,
    icon,
    temperatureMaxC,
    temperatureMinC,
    windMaxMs: round(2 + (wet % 5)),
    gustMaxMs: round(5 + (wet % 7)),
    precipitationMm,
    sunrise: clock(12.5 - daylight / 2),
    sunset: clock(12.5 + daylight / 2),
  };
}

function dayOffset(date: string): number {
  const start = Date.parse(`${date.slice(0, 4)}-01-01T00:00:00.000Z`);
  return Math.round((Date.parse(`${date}T00:00:00.000Z`) - start) / 86_400_000);
}

function clock(hours: number): string {
  const normalized = Math.min(23.99, Math.max(0, hours));
  const whole = Math.floor(normalized);
  const minutes = Math.floor((normalized - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
