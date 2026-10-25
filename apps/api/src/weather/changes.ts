import type { CoachPlan, DailyWeather } from "@killingit/shared";

/**
 * How far a forecast has to move before the coach is asked to reconsider the
 * week. Forecast models update constantly; without a threshold the plan would
 * be regenerated on almost every visit.
 */
export const WEATHER_CHANGE_THRESHOLDS = {
  temperatureMaxC: 5,
  windMaxMs: 5,
  gustMaxMs: 8,
  precipitationMm: 5,
} as const;

function isPrecipitation(weather: DailyWeather): boolean {
  return weather.icon === "rain" || weather.icon === "snow";
}

/**
 * A forecast update matters when it changes whether a day is wet or snowy, or
 * when the temperature, wind, gusts, or rain amount move by a meaningful
 * amount. Cloud-cover changes alone do not affect training.
 */
export function weatherChangedSignificantly(
  previous: DailyWeather | null | undefined,
  next: DailyWeather,
): boolean {
  if (previous === null || previous === undefined) {
    return true;
  }
  if (
    (isPrecipitation(previous) || isPrecipitation(next)) &&
    previous.icon !== next.icon
  ) {
    return true;
  }
  return (
    Math.abs(previous.temperatureMaxC - next.temperatureMaxC) >=
      WEATHER_CHANGE_THRESHOLDS.temperatureMaxC ||
    Math.abs(previous.windMaxMs - next.windMaxMs) >=
      WEATHER_CHANGE_THRESHOLDS.windMaxMs ||
    Math.abs(previous.gustMaxMs - next.gustMaxMs) >=
      WEATHER_CHANGE_THRESHOLDS.gustMaxMs ||
    Math.abs(previous.precipitationMm - next.precipitationMm) >=
      WEATHER_CHANGE_THRESHOLDS.precipitationMm
  );
}

/**
 * True when the stored weather for an upcoming day in the current or planned
 * next week differs significantly from the latest forecast. Every day is
 * compared, including rest days and sessions currently marked indoor: those may
 * have been chosen because the weather was bad, and an improved forecast can
 * turn them back into outdoor training. Past days are ignored because the
 * athlete can no longer act on them. A date that newly has a forecast also
 * counts as a change so a plan created before the location was set starts
 * showing weather.
 */
export function planWeatherChanged(
  plan: CoachPlan,
  forecast: readonly DailyWeather[],
  fromDate: string,
): boolean {
  if (forecast.length === 0) {
    return false;
  }
  const byDate = new Map(forecast.map((day) => [day.date, day]));
  const weeks =
    plan.nextWeek === null ? [plan.week] : [plan.week, plan.nextWeek];
  for (const week of weeks) {
    for (const session of week.sessions) {
      if (session.date < fromDate) {
        continue;
      }
      const next = byDate.get(session.date);
      if (
        next !== undefined &&
        weatherChangedSignificantly(session.weather, next)
      ) {
        return true;
      }
    }
  }
  return false;
}
