import {
  FORECAST_PROVIDER_LABELS,
  formatDailyWeatherParts,
  type DailyForecasts,
  type DailyWeather,
} from "@killingit/shared";
import { Bullet, Bullets } from "./Bullet";
import { WeatherIcon } from "./WeatherIcon";

const SOURCES = ["combined", "openMeteo", "yr"] as const;

/**
 * The forecast lines for a planned outdoor session. Each provider is shown on
 * its own line so the athlete can see where the combined forecast came from.
 * Older stored plans only carry the combined values; those render as a single
 * forecast line.
 */
export function WeatherSummary({
  weather,
  forecasts,
}: {
  weather?: DailyWeather | null | undefined;
  forecasts?: DailyForecasts | null | undefined;
}) {
  const rows = forecasts
    ? SOURCES.map((source) => ({
        key: source,
        label: FORECAST_PROVIDER_LABELS[source],
        weather: forecasts[source],
      }))
    : weather != null
      ? [{ key: "combined" as const, label: "Forecast", weather }]
      : [];
  if (rows.length === 0) {
    return null;
  }
  return (
    <div
      className="flex flex-col gap-0.5 text-xs text-muted-foreground"
      data-testid="weather"
    >
      {rows.map((row) => (
        <span
          key={row.key}
          className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
          data-testid={`weather-${row.key}`}
        >
          {row.weather != null ? (
            <>
              <WeatherIcon icon={row.weather.icon} className="size-4" />
              <span className="font-medium">{row.label}</span>{" "}
              <span>
                <Bullets parts={formatDailyWeatherParts(row.weather)} />
              </span>
            </>
          ) : (
            <span>
              {row.label}
              <Bullet />
              no forecast
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
