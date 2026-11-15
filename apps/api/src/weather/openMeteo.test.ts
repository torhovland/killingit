import { describe, expect, it } from "bun:test";
import type { DailyWeather } from "@killingit/shared";
import { fetchWeatherForecast } from "./openMeteo.js";

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
      sunrise: ["2026-10-25T07:42", "2026-10-26T07:44"] as (string | null)[],
      sunset: ["2026-10-25T16:35", "2026-10-26T16:32"] as (string | null)[],
    },
  };
}

/** Runs a promise that must reject and returns the thrown error. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the forecast to reject");
}

function parseForecast(body: unknown): Promise<DailyWeather[]> {
  return fetchWeatherForecast(
    { latitude: 59.91, longitude: 10.75, name: null },
    {
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
    },
  );
}

describe("fetchWeatherForecast weather icons", () => {
  it("maps the WMO ranges to the five supported icons", async () => {
    const codes = [0, 1, 2, 3, 45, 67, 82, 71, 86, 95, 199];
    const days = await parseForecast({
      daily: {
        time: codes.map(
          (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`,
        ),
        weather_code: codes,
        temperature_2m_max: codes.map(() => 12),
        temperature_2m_min: codes.map(() => 4),
        wind_speed_10m_max: codes.map(() => 4),
        wind_gusts_10m_max: codes.map(() => 8),
        precipitation_sum: codes.map(() => 0),
        sunrise: codes.map(() => null),
        sunset: codes.map(() => null),
      },
    });

    expect(days.map((day) => day.icon)).toEqual([
      "sun",
      "sun",
      "partly_cloudy",
      "very_cloudy",
      "very_cloudy",
      "rain",
      "rain",
      "snow",
      "snow",
      "rain",
      "very_cloudy",
    ]);
  });
});

describe("fetchWeatherForecast parsing", () => {
  it("turns Open-Meteo arrays into daily weather", async () => {
    const days = await parseForecast(forecastBody());

    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({
      date: "2026-10-25",
      icon: "sun",
      temperatureMaxC: 12.4,
      temperatureMinC: 4.2,
      windMaxMs: 4.5,
      gustMaxMs: 8.1,
      precipitationMm: 0,
      sunrise: "07:42",
      sunset: "16:35",
    });
    expect(days[1]?.icon).toBe("rain");
    expect(days[1]?.precipitationMm).toBe(3.6);
    expect(days[1]?.sunrise).toBe("07:44");
    expect(days[1]?.sunset).toBe("16:32");
  });

  it("keeps null daylight values for polar days and nights", async () => {
    const body = forecastBody();
    body.daily.sunrise = [null, "2026-10-26T07:44"];
    body.daily.sunset = [null, "2026-10-26T16:32"];

    const days = await parseForecast(body);

    expect(days[0]?.sunrise).toBeNull();
    expect(days[0]?.sunset).toBeNull();
    expect(days[1]?.sunrise).toBe("07:44");
  });

  it("rejects a malformed daylight time", () => {
    const body = forecastBody();
    body.daily.sunrise = ["not a time", "2026-10-26T07:44"];

    return expect(parseForecast(body)).rejects.toThrow();
  });

  it("skips incomplete trailing days instead of failing the forecast", async () => {
    const days = await parseForecast({
      daily: {
        time: ["2026-10-25", "2026-10-26", "2026-10-27"],
        weather_code: [0, 61, null],
        temperature_2m_max: [12.4, 9.1, null],
        temperature_2m_min: [4.2, 3.8, null],
        wind_speed_10m_max: [4.5, 6.2, null],
        wind_gusts_10m_max: [8.1, 11.4, null],
        precipitation_sum: [0, 3.6, null],
        sunrise: ["2026-10-25T07:42", "2026-10-26T07:44", null],
        sunset: ["2026-10-25T16:35", "2026-10-26T16:32", null],
      },
    });

    expect(days.map((day) => day.date)).toEqual(["2026-10-25", "2026-10-26"]);
  });

  it("rejects a malformed or mismatched response", async () => {
    expect(await rejection(parseForecast({}))).toBeInstanceOf(Error);
    expect(
      await rejection(
        parseForecast({
          daily: { ...forecastBody().daily, time: ["2026-10-25"] },
        }),
      ),
    ).toBeInstanceOf(Error);
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
    expect(url?.searchParams.get("daily")).toContain("sunrise");
    expect(url?.searchParams.get("daily")).toContain("sunset");
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
