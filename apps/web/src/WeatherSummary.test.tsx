import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DailyWeather } from "@killingit/shared";
import { WeatherSummary } from "./WeatherSummary";

function weather(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    date: "2026-10-25",
    icon: "sun",
    temperatureMaxC: 12.4,
    temperatureMinC: 4.2,
    windMaxMs: 4.6,
    gustMaxMs: 8.2,
    precipitationMm: 0,
    sunrise: "07:45",
    sunset: "16:30",
    ...overrides,
  };
}

describe("WeatherSummary", () => {
  it("shows the forecast as a line with centre dots and daylight", () => {
    const html = renderToStaticMarkup(<WeatherSummary weather={weather()} />);

    expect(html).toContain("Forecast");
    expect(html).toContain(
      "Sunny · 4–12 °C · wind 5 m/s (8 m/s) · daylight 07:45 - 16:30",
    );
  });

  it("shows only the daylight times that are available", () => {
    const html = renderToStaticMarkup(
      <WeatherSummary weather={weather({ sunrise: "07:45", sunset: null })} />,
    );

    expect(html).toContain("sunrise 07:45");
    expect(html).not.toContain("sunset");
  });

  it("keeps the weather line when daylight is unavailable", () => {
    const html = renderToStaticMarkup(
      <WeatherSummary weather={weather({ sunrise: null, sunset: null })} />,
    );

    expect(html).toContain("Sunny");
    expect(html).not.toContain("daylight");
  });

  it("labels every provider and the combined forecast", () => {
    const openMeteo = weather();
    const yr = weather({ icon: "rain", sunrise: undefined, sunset: undefined });
    const combined = weather({ icon: "rain" });
    const html = renderToStaticMarkup(
      <WeatherSummary forecasts={{ openMeteo, yr, combined }} />,
    );

    expect(html).toContain("Combined");
    expect(html).toContain("Open-Meteo");
    expect(html).toContain("Yr.no");
    expect(html).toContain(
      "Rain · 4–12 °C · wind 5 m/s (8 m/s) · daylight 07:45 - 16:30",
    );
  });

  it("names a provider that has no forecast", () => {
    const html = renderToStaticMarkup(
      <WeatherSummary
        forecasts={{ openMeteo: weather(), yr: null, combined: weather() }}
      />,
    );

    expect(html).toContain("Yr.no · no forecast");
  });
});
