import { describe, expect, it } from "bun:test";
import type { DailyForecasts, DailyWeather } from "@killingit/shared";
import { showsWeather } from "./sessionWeather";

const weather: DailyWeather = {
  date: "2026-10-21",
  icon: "sun",
  temperatureMaxC: 12,
  temperatureMinC: 6,
  windMaxMs: 3,
  gustMaxMs: 7,
  precipitationMm: 0,
};

const forecasts: DailyForecasts = {
  openMeteo: weather,
  yr: weather,
  combined: weather,
};

describe("showsWeather", () => {
  it("shows the forecast for a workout with the combined weather", () => {
    expect(showsWeather({ type: "workout", canBeOutdoor: true, weather })).toBe(
      true,
    );
  });

  it("shows the forecast when only provider forecasts are attached", () => {
    expect(showsWeather({ type: "workout", forecasts })).toBe(true);
  });

  it("hides the forecast on a rest day", () => {
    expect(showsWeather({ type: "rest", weather, forecasts })).toBe(false);
  });

  it("hides the forecast on an indoor-only session", () => {
    expect(
      showsWeather({
        type: "workout",
        canBeOutdoor: false,
        weather,
        forecasts,
      }),
    ).toBe(false);
  });

  it("hides the forecast when no weather data is attached", () => {
    expect(showsWeather({ type: "workout", canBeOutdoor: true })).toBe(false);
    expect(
      showsWeather({ type: "workout", weather: null, forecasts: null }),
    ).toBe(false);
  });
});
