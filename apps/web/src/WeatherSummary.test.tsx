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
  it("shows the forecast and the local sunrise and sunset", () => {
    const html = renderToStaticMarkup(<WeatherSummary weather={weather()} />);

    expect(html).toContain("Sunny");
    expect(html).toContain("4–12 °C");
    expect(html).toContain("wind 5 m/s");
    expect(html).toContain("gusts 8 m/s");
    expect(html).toContain("sunrise 07:45");
    expect(html).toContain("sunset 16:30");
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
    expect(html).not.toContain("sunrise");
    expect(html).not.toContain("sunset");
  });
});
