import { describe, expect, it } from "bun:test";
import { fetchWeatherForecasts } from "./forecast.js";

function toUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }
  return typeof input === "string" ? new URL(input) : new URL(input.url);
}

function openMeteoBody() {
  return {
    daily: {
      time: ["2026-11-01"],
      weather_code: [0],
      temperature_2m_max: [10],
      temperature_2m_min: [4],
      wind_speed_10m_max: [4],
      wind_gusts_10m_max: [8],
      precipitation_sum: [0],
      sunrise: ["2026-11-01T07:35"],
      sunset: ["2026-11-01T16:28"],
    },
  };
}

function yrBody() {
  return {
    properties: {
      timeseries: [
        {
          time: "2026-11-01T12:00:00Z",
          data: {
            instant: {
              details: {
                air_temperature: 12,
                wind_speed: 6,
                wind_speed_of_gust: 10,
              },
            },
            next_1_hours: {
              summary: { symbol_code: "rain" },
              details: { precipitation_amount: 2 },
            },
          },
        },
      ],
    },
  };
}

describe("fetchWeatherForecasts", () => {
  it("loads both providers and averages them", async () => {
    const forecast = await fetchWeatherForecasts(
      { latitude: 59.91, longitude: 10.75, name: "Oslo" },
      {
        timezone: "Europe/Oslo",
        fetchImpl: (input) => {
          const url = toUrl(input);
          if (url.hostname === "api.open-meteo.com") {
            return Promise.resolve(
              new Response(JSON.stringify(openMeteoBody()), { status: 200 }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify(yrBody()), { status: 200 }),
          );
        },
      },
    );

    expect(forecast.openMeteo).toHaveLength(1);
    expect(forecast.yr).toHaveLength(1);
    expect(forecast.combined).toEqual([
      {
        date: "2026-11-01",
        icon: "rain",
        temperatureMaxC: 11,
        temperatureMinC: 8,
        windMaxMs: 5,
        gustMaxMs: 9,
        precipitationMm: 1,
        sunrise: "07:35",
        sunset: "16:28",
      },
    ]);
  });

  it("keeps the available provider when the other fails", async () => {
    const forecast = await fetchWeatherForecasts(
      { latitude: 59.91, longitude: 10.75, name: "Oslo" },
      {
        timezone: "Europe/Oslo",
        fetchImpl: (input) => {
          const url = toUrl(input);
          if (url.hostname === "api.open-meteo.com") {
            return Promise.resolve(
              new Response(JSON.stringify(openMeteoBody()), { status: 200 }),
            );
          }
          return Promise.resolve(new Response("unavailable", { status: 503 }));
        },
      },
    );

    expect(forecast.openMeteo).toHaveLength(1);
    expect(forecast.yr).toEqual([]);
    expect(forecast.combined).toHaveLength(1);
    expect(forecast.combined[0]?.icon).toBe("sun");
  });

  it("throws when neither provider responds with a forecast", async () => {
    let error: unknown;
    try {
      await fetchWeatherForecasts(
        { latitude: 59.91, longitude: 10.75, name: "Oslo" },
        {
          fetchImpl: () =>
            Promise.resolve(new Response("unavailable", { status: 503 })),
        },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("No weather forecast");
  });
});
