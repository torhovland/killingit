import {
  addDays,
  type AthleteEvent,
  type AthleteLocation,
  type DailyHealthPoint,
  type DailyWeather,
} from "@killingit/shared";
import { loadDietContext } from "../diet/context.js";
import { loadAthleteEvents } from "../events/store.js";
import { loadDailyHealthForUser } from "../metrics/dailyMetrics.js";
import {
  loadBodyHistoryForUser,
  loadThresholdHistoryForUser,
} from "../metrics/store.js";
import {
  fetchWeatherForecasts,
  type WeatherForecastSet,
} from "../weather/forecast.js";
import { loadPlanDayCalories } from "./dayCalories.js";
import type { PlanGenerationContext } from "./generation/types.js";

/** The threshold history a plan prompt reads, as the store returns it. */
export type ThresholdHistory = Awaited<
  ReturnType<typeof loadThresholdHistoryForUser>
>;

/** The body weight and body-fat history a plan prompt reads. */
export type BodyHistory = Awaited<ReturnType<typeof loadBodyHistoryForUser>>;

/** The coach's earlier calorie targets, newest first. */
export type CalorieHistory = NonNullable<
  PlanGenerationContext["calorieHistory"]
>;

/** The advisory loaders a plan run can inject, with their production defaults. */
export interface PlanInputDependencies {
  /** Injectable for route tests; defaults to the stored events. */
  loadEvents?: typeof loadAthleteEvents | undefined;
  /** Injectable for route tests; defaults to the stored food log. */
  loadDiet?: typeof loadDietContext | undefined;
  /** Injectable for tests; defaults to the stored calorie targets. */
  loadDayCalories?: typeof loadPlanDayCalories | undefined;
  /** Injectable for route tests; defaults to the stored threshold timelines. */
  loadThresholdHistory?: typeof loadThresholdHistoryForUser | undefined;
  /** Injectable for route tests; defaults to the stored body metrics. */
  loadBodyHistory?: typeof loadBodyHistoryForUser | undefined;
  /** Injectable for route tests; defaults to the stored daily health series. */
  loadDailyHealth?: typeof loadDailyHealthForUser | undefined;
  /** Injectable for tests; defaults to Open-Meteo and Yr.no. */
  loadForecast?:
    | ((
        location: AthleteLocation,
        timezone: string | null,
      ) => Promise<WeatherForecastSet>)
    | undefined;
}

/** Every advisory prompt input one run read, fail-open. */
export interface PlanInputs {
  events: AthleteEvent[];
  diet: Awaited<ReturnType<typeof loadDietContext>>;
  calorieHistory: CalorieHistory | undefined;
  thresholdHistory: ThresholdHistory;
  bodyHistory: BodyHistory;
  dailyHealth: DailyHealthPoint[] | undefined;
  weatherForecasts: WeatherForecastSet | null;
  forecast: DailyWeather[] | null;
}

/** The threshold history used when the stored values cannot be read. */
const EMPTY_THRESHOLD_HISTORY: ThresholdHistory = {
  points: [],
  timelines: [],
  summaries: [],
};

/** The body history used when the stored measurements cannot be read. */
const EMPTY_BODY_HISTORY: BodyHistory = { weight: [], bodyFat: [] };

/** How far back a plan prompt reads the coach's earlier calorie targets. */
const CALORIE_HISTORY_DAYS = 28;

/** How far back a plan prompt reads the daily health and recovery series. */
const DAILY_HEALTH_HISTORY_DAYS = 42;

/**
 * Reads one advisory plan input. Every prompt input a run reads after the
 * account's own state is advisory: an unavailable events, diet, metrics,
 * calorie or weather source is logged and the coach plans without it, because
 * a plan from a thinner picture is better than no plan at all. Only the inputs
 * `loadPlanGenerationContext` reads are required.
 */
async function attempt<T>(
  label: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.error(
      `[plan] could not read the ${label}; planning without it:`,
      err,
    );
    return fallback;
  }
}

/**
 * Reads every advisory prompt input a plan run enriches its prompts with. One
 * function owns the list and the fail-open policy, so a new input is declared
 * here instead of growing a bespoke `try`/`catch` at its call site.
 */
export async function loadPlanInputs(
  deps: PlanInputDependencies,
  options: {
    userId: number;
    today: string;
    location: AthleteLocation | null;
    timeZone: string | null;
  },
): Promise<PlanInputs> {
  const { userId, today, location, timeZone } = options;
  const loadDayCalories = deps.loadDayCalories ?? loadPlanDayCalories;

  const [
    events,
    diet,
    calorieHistory,
    thresholdHistory,
    bodyHistory,
    dailyHealth,
    weather,
  ] = await Promise.all([
    attempt<AthleteEvent[]>(
      "athlete's events",
      () => (deps.loadEvents ?? loadAthleteEvents)(userId),
      [],
    ),
    attempt<Awaited<ReturnType<typeof loadDietContext>>>(
      "diet log",
      () => (deps.loadDiet ?? loadDietContext)(userId, today),
      null,
    ),
    attempt<CalorieHistory | undefined>(
      "earlier calorie targets",
      async () => {
        const targets = await loadDayCalories(
          userId,
          addDays(today, -CALORIE_HISTORY_DAYS),
          today,
        );
        return [...targets]
          .map(([date, caloriesKcal]) => ({ date, caloriesKcal }))
          .sort((a, b) => b.date.localeCompare(a.date));
      },
      undefined,
    ),
    attempt<ThresholdHistory>(
      "threshold history",
      () =>
        (deps.loadThresholdHistory ?? loadThresholdHistoryForUser)(
          userId,
          today,
        ),
      EMPTY_THRESHOLD_HISTORY,
    ),
    attempt<BodyHistory>(
      "body history",
      () => (deps.loadBodyHistory ?? loadBodyHistoryForUser)(userId),
      EMPTY_BODY_HISTORY,
    ),
    attempt<DailyHealthPoint[] | undefined>(
      "daily health metrics",
      () =>
        (deps.loadDailyHealth ?? loadDailyHealthForUser)(
          userId,
          addDays(today, -DAILY_HEALTH_HISTORY_DAYS),
          today,
        ),
      undefined,
    ),
    location === null
      ? null
      : attempt<WeatherForecastSet | null>(
          "weather forecast",
          () =>
            (
              deps.loadForecast ??
              ((entry: AthleteLocation, zone: string | null) =>
                fetchWeatherForecasts(entry, { timezone: zone }))
            )(location, timeZone),
          null,
        ),
  ]);

  return {
    events,
    diet,
    calorieHistory,
    thresholdHistory,
    bodyHistory,
    dailyHealth,
    weatherForecasts: weather,
    forecast:
      weather !== null && weather.combined.length > 0 ? weather.combined : null,
  };
}
