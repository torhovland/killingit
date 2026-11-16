import type { WeatherIcon } from "@killingit/shared";

/** Ranked from clearest to most severe so one comparison picks a day's icon. */
const ICON_SEVERITY: Record<WeatherIcon, number> = {
  sun: 0,
  partly_cloudy: 1,
  very_cloudy: 2,
  rain: 3,
  snow: 4,
};

/**
 * Returns the more severe of two weather icons: rain beats cloud, and snow
 * beats rain. A tie keeps `first`, so the combined forecast passes Open-Meteo
 * first and keeps its icon when the providers agree.
 */
export function moreSevereIcon(
  first: WeatherIcon,
  second: WeatherIcon,
): WeatherIcon {
  return ICON_SEVERITY[first] >= ICON_SEVERITY[second] ? first : second;
}
