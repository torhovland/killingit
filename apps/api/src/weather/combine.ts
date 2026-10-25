import type {
  DailyForecasts,
  DailyWeather,
  WeatherIcon,
} from "@killingit/shared";

const ICON_SEVERITY: Record<WeatherIcon, number> = {
  sun: 0,
  partly_cloudy: 1,
  very_cloudy: 2,
  rain: 3,
  snow: 4,
};

/**
 * Picks one of two weather types for the combined forecast. Averages only make
 * sense for numbers, so when the providers disagree the more severe condition
 * wins: rain beats cloud, and snow beats rain. A tie keeps the Open-Meteo icon.
 */
export function moreSevereWeatherIcon(
  first: WeatherIcon,
  second: WeatherIcon,
): WeatherIcon {
  return ICON_SEVERITY[first] >= ICON_SEVERITY[second] ? first : second;
}

function average(first: number, second: number): number {
  return (first + second) / 2;
}

function combinedDay(openMeteo: DailyWeather, yr: DailyWeather): DailyWeather {
  return {
    date: openMeteo.date,
    icon: moreSevereWeatherIcon(openMeteo.icon, yr.icon),
    temperatureMaxC: average(openMeteo.temperatureMaxC, yr.temperatureMaxC),
    temperatureMinC: average(openMeteo.temperatureMinC, yr.temperatureMinC),
    windMaxMs: average(openMeteo.windMaxMs, yr.windMaxMs),
    gustMaxMs: average(openMeteo.gustMaxMs, yr.gustMaxMs),
    precipitationMm: average(openMeteo.precipitationMm, yr.precipitationMm),
    // Yr does not publish daylight times, so the combined forecast keeps
    // Open-Meteo's values when they exist.
    sunrise: openMeteo.sunrise ?? yr.sunrise,
    sunset: openMeteo.sunset ?? yr.sunset,
  };
}

/**
 * Builds the averaged forecast from the two providers. A date is included when
 * either provider has it: a single available forecast is copied unchanged, and
 * only dates covered by both are averaged. Missing days are simply absent so
 * the plan can still show the provider that did return data.
 */
export function combineForecasts(
  openMeteo: readonly DailyWeather[],
  yr: readonly DailyWeather[],
): DailyWeather[] {
  const openMeteoByDate = new Map(
    openMeteo.map((day) => [day.date, day] as const),
  );
  const yrByDate = new Map(yr.map((day) => [day.date, day] as const));
  const dates = [...new Set([...openMeteoByDate.keys(), ...yrByDate.keys()])];

  const combined: DailyWeather[] = [];
  for (const date of dates.sort((left, right) => left.localeCompare(right))) {
    const meteo = openMeteoByDate.get(date);
    const norway = yrByDate.get(date);
    if (meteo !== undefined && norway !== undefined) {
      combined.push(combinedDay(meteo, norway));
    } else if (meteo !== undefined) {
      combined.push(meteo);
    } else if (norway !== undefined) {
      combined.push(norway);
    }
  }
  return combined;
}

/** Groups the combined and per-provider forecasts by date for plan storage. */
export function forecastsByDate(
  openMeteo: readonly DailyWeather[],
  yr: readonly DailyWeather[],
  combined: readonly DailyWeather[],
): Map<string, DailyForecasts> {
  const openMeteoByDate = new Map(
    openMeteo.map((day) => [day.date, day] as const),
  );
  const yrByDate = new Map(yr.map((day) => [day.date, day] as const));
  const combinedByDate = new Map(
    combined.map((day) => [day.date, day] as const),
  );
  const byDate = new Map<string, DailyForecasts>();
  for (const date of combinedByDate.keys()) {
    byDate.set(date, {
      openMeteo: openMeteoByDate.get(date) ?? null,
      yr: yrByDate.get(date) ?? null,
      combined: combinedByDate.get(date) ?? null,
    });
  }
  return byDate;
}
