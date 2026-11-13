import { describe, expect, it } from "bun:test";
import type { AthleteLocation } from "@killingit/shared";
import {
  fetchWeatherForecasts,
  type WeatherForecastCacheEntry,
} from "./forecast.js";
import type { FetchLike } from "./openMeteo.js";

const OSLO: AthleteLocation = {
  latitude: 59.91,
  longitude: 10.75,
  name: "Oslo",
};
const MINUTE_MS = 60_000;
const LAST_MODIFIED = "Sun, 01 Nov 2026 08:00:00 GMT";

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

/** A fetch stub whose provider answers a test can change between calls. */
function stubProviders() {
  const calls = { openMeteo: 0, yr: 0 };
  const yrRequests: Headers[] = [];
  const state: {
    openMeteoStatus: number;
    yrStatus: number;
    yrHeaders: Record<string, string>;
  } = { openMeteoStatus: 200, yrStatus: 200, yrHeaders: {} };

  const fetchImpl: FetchLike = (input, init) => {
    const url = toUrl(input);
    if (url.hostname === "api.open-meteo.com") {
      calls.openMeteo += 1;
      if (state.openMeteoStatus !== 200) {
        return Promise.resolve(
          new Response("unavailable", { status: state.openMeteoStatus }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(openMeteoBody()), { status: 200 }),
      );
    }
    calls.yr += 1;
    yrRequests.push(new Headers(init?.headers));
    if (state.yrStatus === 304) {
      return Promise.resolve(
        new Response(null, { status: 304, headers: state.yrHeaders }),
      );
    }
    if (state.yrStatus !== 200) {
      return Promise.resolve(
        new Response("unavailable", { status: state.yrStatus }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(yrBody()), {
        status: 200,
        headers: state.yrHeaders,
      }),
    );
  };

  return { fetchImpl, calls, yrRequests, state };
}

/** One test's own cache and clock, so no state leaks between tests. */
function harness() {
  const cache = new Map<string, WeatherForecastCacheEntry>();
  let now = Date.UTC(2026, 10, 1, 9);
  const stub = stubProviders();
  return {
    ...stub,
    load(
      location: AthleteLocation = OSLO,
      timezone: string | null = "Europe/Oslo",
    ) {
      return fetchWeatherForecasts(location, {
        timezone,
        fetchImpl: stub.fetchImpl,
        cache,
        now: () => now,
      });
    },
    advance(minutes: number) {
      now += minutes * MINUTE_MS;
    },
  };
}

describe("fetchWeatherForecasts", () => {
  it("loads both providers and averages them", async () => {
    const forecast = await fetchWeatherForecasts(OSLO, {
      timezone: "Europe/Oslo",
      cache: new Map(),
      fetchImpl: stubProviders().fetchImpl,
    });

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
    const stub = stubProviders();
    stub.state.yrStatus = 503;
    const forecast = await fetchWeatherForecasts(OSLO, {
      timezone: "Europe/Oslo",
      cache: new Map(),
      fetchImpl: stub.fetchImpl,
    });

    expect(forecast.openMeteo).toHaveLength(1);
    expect(forecast.yr).toEqual([]);
    expect(forecast.combined).toHaveLength(1);
    expect(forecast.combined[0]?.icon).toBe("sun");
  });

  it("throws when neither provider responds with a forecast", async () => {
    const stub = stubProviders();
    stub.state.openMeteoStatus = 503;
    stub.state.yrStatus = 503;
    let error: unknown;
    try {
      await fetchWeatherForecasts(OSLO, {
        cache: new Map(),
        fetchImpl: stub.fetchImpl,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("No weather forecast");
  });
});

describe("the weather forecast cache", () => {
  it("fetches once for the same location inside the TTL", async () => {
    const weather = harness();
    const first = await weather.load();
    weather.advance(30);
    const second = await weather.load({
      latitude: 59.9104,
      longitude: 10.7502,
      name: "Oslo",
    });

    expect(weather.calls).toEqual({ openMeteo: 1, yr: 1 });
    expect(second).toEqual(first);
  });

  it("caches a different rounded location and time zone separately", async () => {
    const weather = harness();
    await weather.load();
    await weather.load({ latitude: 59.95, longitude: 10.75, name: null });
    await weather.load(OSLO, "Europe/London");

    expect(weather.calls).toEqual({ openMeteo: 3, yr: 3 });
  });

  it("refetches once the TTL has passed", async () => {
    const weather = harness();
    await weather.load();
    weather.advance(61);
    await weather.load();

    expect(weather.calls).toEqual({ openMeteo: 2, yr: 2 });
  });

  it("honours Yr's Expires beyond the cache TTL", async () => {
    const weather = harness();
    weather.state.yrHeaders = {
      Expires: new Date(Date.UTC(2026, 10, 1, 12)).toUTCString(),
    };
    await weather.load();

    weather.advance(90);
    await weather.load();
    expect(weather.calls).toEqual({ openMeteo: 1, yr: 1 });

    weather.advance(151);
    await weather.load();
    expect(weather.calls).toEqual({ openMeteo: 2, yr: 2 });
  });

  it("keeps the cached forecast when Yr answers 304", async () => {
    const weather = harness();
    weather.state.yrHeaders = { "Last-Modified": LAST_MODIFIED };
    const first = await weather.load();
    expect(weather.yrRequests[0]?.get("if-modified-since")).toBeNull();

    weather.state.yrStatus = 304;
    weather.advance(61);
    const second = await weather.load();

    expect(weather.yrRequests[1]?.get("if-modified-since")).toBe(LAST_MODIFIED);
    expect(second).toEqual(first);
    expect(weather.calls).toEqual({ openMeteo: 2, yr: 2 });
  });

  it("keeps the cached rows when a refresh fails", async () => {
    const weather = harness();
    const first = await weather.load();

    weather.state.openMeteoStatus = 503;
    weather.state.yrStatus = 503;
    weather.advance(61);
    const second = await weather.load();

    expect(second).toEqual(first);
    expect(weather.calls).toEqual({ openMeteo: 2, yr: 2 });
  });
});
