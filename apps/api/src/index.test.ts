import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import app from "./index";
import { withSentry } from "./instrumentation/sentry.js";

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
