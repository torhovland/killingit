import { describe, expect, it } from "bun:test";
import {
  fetchYrForecast,
  parseYrResponse,
  weatherIconForYrSymbol,
  YR_USER_AGENT,
} from "./yr.js";

function toUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }
  return typeof input === "string" ? new URL(input) : new URL(input.url);
}

function entry(options: {
  time: string;
  temperature: number;
  wind: number;
  gust?: number;
  symbol: string;
  precipitation?: number;
  window?: "hour" | "six";
}) {
  const window = options.window ?? "hour";
  const next =
    window === "hour"
      ? {
          summary: { symbol_code: options.symbol },
          details: { precipitation_amount: options.precipitation ?? 0 },
        }
      : {
          summary: { symbol_code: options.symbol },
          details: { precipitation_amount: options.precipitation ?? 0 },
        };
  return {
    time: options.time,
    data: {
      instant: {
        details: {
          air_temperature: options.temperature,
          wind_speed: options.wind,
          ...(options.gust !== undefined
            ? { wind_speed_of_gust: options.gust }
            : {}),
        },
      },
      [window === "hour" ? "next_1_hours" : "next_6_hours"]: next,
    },
  };
}

function response(timeseries: unknown[]): unknown {
  return { properties: { timeseries } };
}

describe("weatherIconForYrSymbol", () => {
  it("maps MET Norway's symbol families to the five display icons", () => {
    expect(weatherIconForYrSymbol("clearsky_day")).toBe("sun");
    expect(weatherIconForYrSymbol("fair_night")).toBe("partly_cloudy");
    expect(weatherIconForYrSymbol("partlycloudy_day")).toBe("partly_cloudy");
    expect(weatherIconForYrSymbol("cloudy")).toBe("very_cloudy");
    expect(weatherIconForYrSymbol("fog")).toBe("very_cloudy");
    expect(weatherIconForYrSymbol("lightrain")).toBe("rain");
    expect(weatherIconForYrSymbol("heavyrainshowers_day")).toBe("rain");
    expect(weatherIconForYrSymbol("lightsnow")).toBe("snow");
    expect(weatherIconForYrSymbol("sleetandthunder")).toBe("snow");
    expect(weatherIconForYrSymbol("something-new")).toBe("very_cloudy");
  });
});

describe("parseYrResponse", () => {
  it("aggregates hourly entries into daily weather", () => {
    const days = parseYrResponse(
      response([
        entry({
          time: "2026-11-01T00:00:00Z",
          temperature: 4,
          wind: 3,
          gust: 8,
          symbol: "cloudy",
          precipitation: 0.4,
        }),
        entry({
          time: "2026-11-01T12:00:00Z",
          temperature: 9,
          wind: 7,
          gust: 12,
          symbol: "lightrain",
          precipitation: 2.1,
        }),
        entry({
          time: "2026-11-02T00:00:00Z",
          temperature: 2,
          wind: 1,
          gust: 2,
          symbol: "clearsky_day",
          precipitation: 0,
        }),
      ]),
    );

    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({
      date: "2026-11-01",
      icon: "rain",
      temperatureMaxC: 9,
      temperatureMinC: 4,
      windMaxMs: 7,
      gustMaxMs: 12,
      precipitationMm: 2.5,
    });
    expect(days[1]?.icon).toBe("sun");
    expect(days[1]?.gustMaxMs).toBe(2);
  });

  it("uses the local calendar day for the athlete's time zone", () => {
    const days = parseYrResponse(
      response([
        entry({
          time: "2026-11-01T22:30:00Z",
          temperature: 3,
          wind: 1,
          symbol: "clearsky_night",
        }),
        entry({
          time: "2026-11-01T23:30:00Z",
          temperature: 1,
          wind: 1,
          symbol: "clearsky_night",
        }),
      ]),
      "Europe/Oslo",
    );

    expect(days.map((day) => day.date)).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("falls back to the sustained wind when a gust is not reported", () => {
    const days = parseYrResponse(
      response([
        entry({
          time: "2026-11-01T00:00:00Z",
          temperature: 4,
          wind: 6,
          symbol: "partlycloudy_day",
        }),
      ]),
    );

    expect(days[0]?.windMaxMs).toBe(6);
    expect(days[0]?.gustMaxMs).toBe(6);
  });

  it("rejects a malformed response", () => {
    expect(() => parseYrResponse({})).toThrow();
    expect(() => parseYrResponse(response([{ time: "not a time" }]))).toThrow();
    expect(() =>
      parseYrResponse(
        response([
          {
            time: "2026-11-01T00:00:00Z",
            data: { instant: { details: {} } },
          },
        ]),
      ),
    ).toThrow();
  });
});

describe("fetchYrForecast", () => {
  it("identifies itself to MET Norway and parses the response", async () => {
    const requested: URL[] = [];
    let userAgent = "";
    const days = await fetchYrForecast(
      { latitude: 59.91, longitude: 10.75, name: "Oslo" },
      {
        timezone: "Europe/Oslo",
        fetchImpl: (input, init) => {
          requested.push(toUrl(input));
          userAgent = new Headers(init?.headers).get("user-agent") ?? "";
          return Promise.resolve(
            new Response(
              JSON.stringify(
                response([
                  entry({
                    time: "2026-11-01T12:00:00Z",
                    temperature: 8,
                    wind: 4,
                    gust: 9,
                    symbol: "rain",
                    precipitation: 1.5,
                  }),
                ]),
              ),
              { status: 200 },
            ),
          );
        },
      },
    );

    expect(days).toHaveLength(1);
    expect(days[0]?.date).toBe("2026-11-01");
    expect(userAgent).toBe(YR_USER_AGENT);
    expect(requested[0]?.searchParams.get("lat")).toBe("59.91");
    expect(requested[0]?.searchParams.get("lon")).toBe("10.75");
  });

  it("rejects a non-success response", () =>
    expect(
      fetchYrForecast(
        { latitude: 59.91, longitude: 10.75, name: null },
        {
          fetchImpl: () =>
            Promise.resolve(new Response("nope", { status: 503 })),
        },
      ),
    ).rejects.toThrow("503"));
});
