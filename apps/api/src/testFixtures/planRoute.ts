import type { DailyWeather } from "@killingit/shared";
import { combineForecasts } from "../weather/combine.js";
import type { WeatherForecastSet } from "../weather/forecast.js";
import type { MemoryGenerationStore } from "./app.js";

/** A running row is stale once its five-minute lease has expired. */
export const STALE_RUN_MS = 5 * 60 * 1000;

/** A forecast set for the fixture week, with Yr optional. */
export function forecastSet(
  openMeteo: DailyWeather[],
  yr: DailyWeather[] = [],
): WeatherForecastSet {
  return {
    openMeteo,
    yr,
    combined: combineForecasts(openMeteo, yr),
  };
}

/**
 * Waits for the background generation to settle in the in-memory store. The
 * allowance is generous because a run reads some data from the test database,
 * which is remote in some environments.
 */
export async function waitForGeneration(
  store: MemoryGenerationStore,
): Promise<void> {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if (store.status.status === "done" || store.status.status === "error") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("generation did not finish");
}
