import type { CoachPlan, DailyWeather } from "@killingit/shared";

function forecastFor(
  date: string,
  byDate: ReadonlyMap<string, DailyWeather>,
): DailyWeather | null {
  return byDate.get(date) ?? null;
}

/**
 * Attaches the forecast day that matches each session to the plan. Weather is
 * attached by the server rather than requested from the model so icons and
 * values come from the forecast. A plan without a forecast is returned
 * unchanged.
 */
export function applyForecastToPlan(
  plan: CoachPlan,
  forecast: readonly DailyWeather[] | null | undefined,
): CoachPlan {
  if (!forecast || forecast.length === 0) {
    return plan;
  }
  const byDate = new Map(forecast.map((day) => [day.date, day]));
  return {
    ...plan,
    week: {
      ...plan.week,
      sessions: plan.week.sessions.map((session) => ({
        ...session,
        weather: forecastFor(session.date, byDate),
      })),
    },
    today: {
      ...plan.today,
      weather: forecastFor(plan.today.date, byDate),
    },
    tomorrow:
      plan.tomorrow === null
        ? null
        : {
            ...plan.tomorrow,
            weather: forecastFor(plan.tomorrow.date, byDate),
          },
  };
}
