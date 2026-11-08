import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import app from "./index";
import { withSentry } from "./instrumentation/sentry.js";

/**
 * One sample route from every protected family. Authentication is applied to
 * `/api/*` as a whole rather than per prefix, so these are a regression guard:
 * a route that moves or is mounted without its old prefix must stay protected.
 * The plan routes are called out because they used to inherit auth only from
 * the `/coaching/*` prefix (issue #161).
 */
const PROTECTED_ROUTES = [
  { method: "GET", path: "/api/me" },
  { method: "GET", path: "/api/questions" },
  { method: "GET", path: "/api/garmin/status" },
  { method: "GET", path: "/api/llm/settings" },
  { method: "GET", path: "/api/weather/geocode?q=Oslo" },
  { method: "GET", path: "/api/coaching/activities/cached" },
  { method: "GET", path: "/api/coaching/plan?today=2026-11-08" },
  { method: "GET", path: "/api/coaching/plan/workouts/2026-11-08" },
  { method: "POST", path: "/api/coaching/plan/generate" },
  { method: "GET", path: "/api/fitness?today=2026-11-08" },
  { method: "GET", path: "/api/calendar?today=2026-11-08" },
  { method: "GET", path: "/api/diet/summary" },
  { method: "GET", path: "/api/admin/questions" },
] as const;

describe("api", () => {
  it("responds ok on /api/health", async () => {
    const res = await app.fetch(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("killingit-api");
  });

  it("greets on /api/greet", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/greet?name=tor"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Hello, tor!");
  });

  it.each(PROTECTED_ROUTES)(
    "rejects $method $path without a bearer token",
    async ({ method, path }) => {
      const res = await app.fetch(
        new Request(`http://localhost${path}`, { method }),
      );
      expect(res.status).toBe(401);
    },
  );

  it("protects unknown /api routes instead of exposing them as 404", async () => {
    // Auth is default-on: a route that is not in the public allowlist is
    // rejected before routing, so a newly added route can never be public by
    // accident.
    const res = await app.fetch(
      new Request("http://localhost/api/not-a-registered-route"),
    );
    expect(res.status).toBe(401);
  });
});

describe("withSentry", () => {
  it("is a no-op without a DSN and leaves the app functional", async () => {
    // No SENTRY_DSN is set in the test environment, so withSentry returns the
    // app untouched; a throwing route still surfaces Hono's default 500.
    const throwing = new Hono();
    withSentry(throwing);
    throwing.get("/boom", () => {
      throw new Error("boom");
    });

    const res = await throwing.fetch(new Request("http://localhost/boom"));
    expect(res.status).toBe(500);
  });
});
