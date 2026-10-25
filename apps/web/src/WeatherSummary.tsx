import { WEATHER_ICON_LABELS, type DailyWeather } from "@killingit/shared";
import { WeatherIcon } from "./WeatherIcon";

/**
 * A compact forecast line for a planned outdoor session. Temperature is shown
 * in °C and wind speeds in m/s, matching the units the coach receives. Sunrise
 * and sunset are the location's local clock times, shown next to the weather so
 * the athlete can see the daylight window.
 */
export function WeatherSummary({ weather }: { weather: DailyWeather }) {
  const low = Math.round(weather.temperatureMinC);
  const high = Math.round(weather.temperatureMaxC);
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
      data-testid="weather"
    >
      <WeatherIcon icon={weather.icon} className="size-4" />
      <span>{WEATHER_ICON_LABELS[weather.icon]}</span>
      <span>{low === high ? `${high} °C` : `${low}–${high} °C`}</span>
      <span>wind {Math.round(weather.windMaxMs)} m/s</span>
      <span>gusts {Math.round(weather.gustMaxMs)} m/s</span>
      {weather.sunrise != null && <span>sunrise {weather.sunrise}</span>}
      {weather.sunset != null && <span>sunset {weather.sunset}</span>}
    </span>
  );
}
