import { describe, expect, it } from "bun:test";
import {
  fetchWeatherForecast,
  parseForecastResponse,
  parseGeocodeResponse,
  searchLocations,
  weatherIconForCode,
} from "./openMeteo.js";

function toUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }
  return typeof input === "string" ? new URL(input) : new URL(input.url);
}

function forecastBody() {
  return {
    daily: {
      time: ["2026-10-25", "2026-10-26"],
      weather_code: [0, 61],
      temperature_2m_max: [12.4, 9.1],
      temperature_2m_min: [4.2, 3.8],
      wind_speed_10m_max: [4.5, 6.2],
      wind_gusts_10m_max: [8.1, 11.4],
      precipitation_sum: [0, 3.6],
    },
  };
}

describe("weatherIconForCode", () => {
  it("maps the WMO ranges to the five supported icons", () => {
    expect(weatherIconForCode(0)).toBe("sun");
    expect(weatherIconForCode(1)).toBe("sun");
    expect(weatherIconForCode(2)).toBe("partly_cloudy");
    expect(weatherIconForCode(3)).toBe("very_cloudy");
    expect(weatherIconForCode(45)).toBe("very_cloudy");
    expect(weatherIconForCode(67)).toBe("rain");
    expect(weatherIconForCode(82)).toBe("rain");
    expect(weatherIconForCode(71)).toBe("snow");
    expect(weatherIconForCode(86)).toBe("snow");
    expect(weatherIconForCode(95)).toBe("rain");
    expect(weatherIconForCode(199)).toBe("very_cloudy");
  });
});

describe("parseForecastResponse", () => {
  it("turns Open-Meteo arrays into daily weather", () => {
    const days = parseForecastResponse(forecastBody());

    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({
      date: "2026-10-25",
      icon: "sun",
      temperatureMaxC: 12.4,
      temperatureMinC: 4.2,
      windMaxMs: 4.5,
      gustMaxMs: 8.1,
      precipitationMm: 0,
    });
    expect(days[1]?.icon).toBe("rain");
    expect(days[1]?.precipitationMm).toBe(3.6);
  });

  it("skips incomplete trailing days instead of failing the forecast", () => {
    const days = parseForecastResponse({
      daily: {
        time: ["2026-10-25", "2026-10-26", "2026-10-27"],
        weather_code: [0, 61, null],
        temperature_2m_max: [12.4, 9.1, null],
        temperature_2m_min: [4.2, 3.8, null],
        wind_speed_10m_max: [4.5, 6.2, null],
        wind_gusts_10m_max: [8.1, 11.4, null],
        precipitation_sum: [0, 3.6, null],
      },
    });

    expect(days.map((day) => day.date)).toEqual(["2026-10-25", "2026-10-26"]);
  });

  it("rejects a malformed or mismatched response", () => {
    expect(() => parseForecastResponse({})).toThrow();
    expect(() =>
      parseForecastResponse({
        daily: { ...forecastBody().daily, time: ["2026-10-25"] },
      }),
    ).toThrow();
  });
});

describe("fetchWeatherForecast", () => {
  it("requests m/s wind and parses the response", async () => {
    const requested: URL[] = [];
    const days = await fetchWeatherForecast(
      { latitude: 59.91, longitude: 10.75, name: "Oslo" },
      {
        fetchImpl: (input) => {
          requested.push(toUrl(input));
          return Promise.resolve(
            new Response(JSON.stringify(forecastBody()), { status: 200 }),
          );
        },
      },
    );

    const url = requested[0];
    expect(days).toHaveLength(2);
    expect(url).toBeDefined();
    expect(url?.searchParams.get("wind_speed_unit")).toBe("ms");
    expect(url?.searchParams.get("timezone")).toBe("auto");
    expect(url?.searchParams.get("latitude")).toBe("59.91");
    expect(url?.searchParams.get("daily")).toContain("weather_code");
  });

  it("rejects a non-success response", () =>
    expect(
      fetchWeatherForecast(
        { latitude: 59.91, longitude: 10.75, name: null },
        {
          fetchImpl: () =>
            Promise.resolve(new Response("nope", { status: 500 })),
        },
      ),
    ).rejects.toThrow("500"));
});

describe("geocoding", () => {
  it("parses valid results and ignores malformed entries", () => {
    expect(
      parseGeocodeResponse({
        results: [
          {
            name: "Oslo",
            latitude: 59.91,
            longitude: 10.75,
            country: "Norway",
            admin1: "Oslo",
          },
          { name: "Broken", latitude: 200, longitude: 10 },
          null,
        ],
      }),
    ).toEqual([
      {
        name: "Oslo",
        latitude: 59.91,
        longitude: 10.75,
        country: "Norway",
        admin1: "Oslo",
      },
    ]);
  });

  it("returns an empty list when the service finds nothing", () => {
    expect(parseGeocodeResponse({})).toEqual([]);
    expect(parseGeocodeResponse({ results: [] })).toEqual([]);
  });

  it("requests the geocoding API with the query", async () => {
    let requestedUrl = "";
    const results = await searchLocations("Bergen", (input) => {
      requestedUrl = toUrl(input).toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                name: "Bergen",
                latitude: 60.39,
                longitude: 5.32,
                country: "Norway",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });

    expect(results[0]?.name).toBe("Bergen");
    expect(requestedUrl).toContain("name=Bergen");
  });

  it("rejects a non-success response", () =>
    expect(
      searchLocations("Bergen", () =>
        Promise.resolve(new Response("nope", { status: 502 })),
      ),
    ).rejects.toThrow("502"));
});
