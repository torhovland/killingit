import { describe, expect, it } from "bun:test";
import type { DailyWeather } from "@killingit/shared";
import { fetchYrForecast } from "./yr.js";

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

/** Runs a promise that must reject and returns the thrown error. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the forecast to reject");
}

function parseForecast(
  body: unknown,
  timezone = "UTC",
): Promise<DailyWeather[]> {
  return fetchYrForecast(
    { latitude: 59.91, longitude: 10.75, name: null },
    {
      timezone,
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
    },
  ).then((forecast) => forecast.days);
}

describe("fetchYrForecast weather icons", () => {
  it("maps MET Norway's symbol families to the five display icons", async () => {
    const symbols = [
      "clearsky_day",
      "fair_night",
      "partlycloudy_day",
      "cloudy",
      "fog",
      "lightrain",
      "heavyrainshowers_day",
      "lightsnow",
      "sleetandthunder",
      "something-new",
    ];
    const days = await parseForecast(
      response(
        symbols.map((symbol, index) =>
          entry({
            time: `2026-11-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
            temperature: 4,
            wind: 2,
            symbol,
          }),
        ),
      ),
    );

    expect(days.map((day) => day.icon)).toEqual([
      "sun",
      "partly_cloudy",
      "partly_cloudy",
      "very_cloudy",
      "very_cloudy",
      "rain",
      "rain",
      "snow",
      "snow",
      "very_cloudy",
    ]);
  });
});

describe("fetchYrForecast parsing", () => {
  it("aggregates hourly entries into daily weather", async () => {
    const days = await parseForecast(
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

  it("uses the local calendar day for the athlete's time zone", async () => {
    const days = await parseForecast(
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

  it("falls back to the sustained wind when a gust is not reported", async () => {
    const days = await parseForecast(
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

  it("rejects a malformed response", async () => {
    expect(await rejection(parseForecast({}))).toBeInstanceOf(Error);
    expect(
      await rejection(parseForecast(response([{ time: "not a time" }]))),
    ).toBeInstanceOf(Error);
    expect(
      await rejection(
        parseForecast(
          response([
            {
              time: "2026-11-01T00:00:00Z",
              data: { instant: { details: {} } },
            },
          ]),
        ),
      ),
    ).toBeInstanceOf(Error);
  });
});

describe("fetchYrForecast", () => {
  it("identifies itself to MET Norway and parses the response", async () => {
    const requested: URL[] = [];
    let userAgent = "";
    const forecast = await fetchYrForecast(
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

    expect(forecast.notModified).toBe(false);
    expect(forecast.days).toHaveLength(1);
    expect(forecast.days[0]?.date).toBe("2026-11-01");
    // MET Norway asks clients to identify themselves with a contact URL.
    expect(userAgent).toContain("killingit/");
    expect(userAgent).toContain("github.com/torhovland/killingit");
    expect(requested[0]?.searchParams.get("lat")).toBe("59.91");
    expect(requested[0]?.searchParams.get("lon")).toBe("10.75");
  });

  it("surfaces the provider's Expires so clients know when they may ask again", async () => {
    const expires = "Sun, 01 Nov 2026 12:00:00 GMT";
    const forecast = await fetchYrForecast(
      { latitude: 59.91, longitude: 10.75, name: null },
      {
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify(response([])), {
              status: 200,
              headers: {
                Expires: expires,
                "Last-Modified": "Sat, 31 Oct 2026",
              },
            }),
          ),
      },
    );

    expect(forecast.expiresAt).toBe(Date.parse(expires));
    expect(forecast.lastModified).toBe("Sat, 31 Oct 2026");
  });

  it("falls back to Cache-Control max-age when no Expires is sent", async () => {
    const forecast = await fetchYrForecast(
      { latitude: 59.91, longitude: 10.75, name: null },
      {
        now: () => 1_000,
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify(response([])), {
              status: 200,
              headers: { "Cache-Control": "public, max-age=900" },
            }),
          ),
      },
    );

    expect(forecast.expiresAt).toBe(1_000 + 900_000);
  });

  it("revalidates with If-Modified-Since and reports 304 as unchanged", async () => {
    const sent: Headers[] = [];
    const forecast = await fetchYrForecast(
      { latitude: 59.91, longitude: 10.75, name: null },
      {
        ifModifiedSince: "Sat, 31 Oct 2026 08:00:00 GMT",
        fetchImpl: (_input, init) => {
          sent.push(new Headers(init?.headers));
          return Promise.resolve(new Response(null, { status: 304 }));
        },
      },
    );

    expect(sent[0]?.get("if-modified-since")).toBe(
      "Sat, 31 Oct 2026 08:00:00 GMT",
    );
    expect(forecast.notModified).toBe(true);
    expect(forecast.days).toEqual([]);
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
