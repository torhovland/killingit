import { describe, expect, it } from "bun:test";
import { createApp } from "../index.js";

const userStore = {
  ensureUser: (sub: string) =>
    Promise.resolve({
      id: 1,
      sub,
      role: "member" as const,
      timezone: null,
      location: null,
      createdAt: new Date(0),
    }),
  getById: () => Promise.resolve(null),
  updateSettings: () => Promise.reject(new Error("not used")),
};

function makeApp(
  searchLocations: (query: string) => Promise<
    Array<{
      name: string;
      latitude: number;
      longitude: number;
      country: string | null;
      admin1: string | null;
    }>
  >,
) {
  return createApp({
    authProvider: { verify: () => Promise.resolve({ sub: "athlete-1" }) },
    userStore,
    searchLocations,
  });
}

function request(path: string, authenticated = true): Request {
  const headers = new Headers();
  if (authenticated) {
    headers.set("authorization", "Bearer anything");
  }
  return new Request(`http://localhost${path}`, { headers });
}

describe("GET /api/weather/geocode", () => {
  it("requires authentication", async () => {
    const app = makeApp(() => Promise.resolve([]));
    const response = await app.fetch(
      request("/api/weather/geocode?q=Oslo", false),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a blank or too-long query", async () => {
    const app = makeApp(() => Promise.resolve([]));
    expect((await app.fetch(request("/api/weather/geocode"))).status).toBe(400);
    expect(
      (await app.fetch(request("/api/weather/geocode?q=%20%20"))).status,
    ).toBe(400);
    expect(
      (await app.fetch(request(`/api/weather/geocode?q=${"a".repeat(101)}`)))
        .status,
    ).toBe(400);
  });

  it("returns geocoded results", async () => {
    const seen: string[] = [];
    const app = makeApp((query) => {
      seen.push(query);
      return Promise.resolve([
        {
          name: "Oslo",
          latitude: 59.91,
          longitude: 10.75,
          country: "Norway",
          admin1: "Oslo",
        },
      ]);
    });

    const response = await app.fetch(request("/api/weather/geocode?q=Oslo"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          name: "Oslo",
          latitude: 59.91,
          longitude: 10.75,
          country: "Norway",
          admin1: "Oslo",
        },
      ],
    });
    expect(seen).toEqual(["Oslo"]);
  });

  it("maps an upstream failure to 502", async () => {
    const app = makeApp(() => Promise.reject(new Error("down")));
    const response = await app.fetch(request("/api/weather/geocode?q=Oslo"));
    expect(response.status).toBe(502);
  });
});
