import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requestLogger } from "./requestLog.js";

/** Collects the lines the middleware writes instead of printing them. */
function collectLines() {
  const lines: Array<{ severity: string; line: string }> = [];
  return {
    lines,
    write: (severity: string, line: string) => lines.push({ severity, line }),
    /** The parsed payload of every line, in write order. */
    parsed: () =>
      lines.map(({ line }) => JSON.parse(line) as Record<string, unknown>),
  };
}

/** A tiny app whose error handler mirrors `createApp` without printing. */
function appWithLogger(options: Parameters<typeof requestLogger>[0]) {
  const app = new Hono();
  app.onError((_error, c) => c.text("Internal Server Error", 500));
  app.use("*", requestLogger(options));
  return app;
}

describe("requestLogger", () => {
  it("writes one JSON line with the request fields", async () => {
    const collected = collectLines();
    const app = appWithLogger({ write: collected.write });
    app.get("/api/health", (c) => c.json({ status: "ok" }));

    const before = Date.now();
    await app.fetch(new Request("http://localhost/api/health"));
    const after = Date.now();

    expect(collected.lines).toHaveLength(1);
    expect(collected.lines[0]?.severity).toBe("INFO");
    const line = collected.parsed()[0];
    expect(line).toEqual({
      severity: "INFO",
      time: expect.any(String),
      event: "request",
      requestId: expect.any(String),
      method: "GET",
      path: "/api/health",
      status: 200,
      durationMs: expect.any(Number),
    });
    const time = Date.parse(String(line?.time));
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
    expect(line?.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it("keeps the query string and the body out of the line", async () => {
    const collected = collectLines();
    const app = appWithLogger({ write: collected.write });
    app.post("/api/weather/geocode", (c) => c.json({ ok: true }));

    await app.fetch(
      new Request("http://localhost/api/weather/geocode?q=Storgata+1", {
        method: "POST",
        body: JSON.stringify({ note: "private" }),
        headers: { "content-type": "application/json" },
      }),
    );

    const [entry] = collected.lines;
    expect(entry?.line).not.toContain("Storgata");
    expect(entry?.line).not.toContain("private");
    expect(collected.parsed()[0]?.path).toBe("/api/weather/geocode");
  });

  it("reuses and echoes a request id supplied by the caller", async () => {
    const collected = collectLines();
    const app = appWithLogger({ write: collected.write });
    app.get("/api/health", (c) => c.json({ status: "ok" }));

    const res = await app.fetch(
      new Request("http://localhost/api/health", {
        headers: { "x-request-id": "web-1234" },
      }),
    );

    expect(res.headers.get("x-request-id")).toBe("web-1234");
    expect(collected.parsed()[0]?.requestId).toBe("web-1234");
  });

  it("replaces a caller-supplied id that is not header-safe", async () => {
    const collected = collectLines();
    const app = appWithLogger({ write: collected.write });
    app.get("/api/health", (c) => c.json({ status: "ok" }));

    const res = await app.fetch(
      new Request("http://localhost/api/health", {
        headers: { "x-request-id": "not an id" },
      }),
    );

    const requestId = collected.parsed()[0]?.requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-request-id")).toBe(requestId as string);
  });

  it("logs a client failure as a warning", async () => {
    const collected = collectLines();
    const app = appWithLogger({ write: collected.write });
    app.get("/missing", (c) => c.text("not here", 404));

    await app.fetch(new Request("http://localhost/missing"));

    expect(collected.lines[0]?.severity).toBe("WARNING");
    expect(collected.parsed()[0]?.status).toBe(404);
  });

  it("logs a thrown failure as an error with its name, message and stack", async () => {
    const collected = collectLines();
    const app = appWithLogger({ write: collected.write });
    app.get("/boom", () => {
      throw new TypeError("boom");
    });

    const res = await app.fetch(new Request("http://localhost/boom"));

    expect(res.status).toBe(500);
    expect(collected.lines[0]?.severity).toBe("ERROR");
    expect(collected.parsed()[0]).toMatchObject({
      severity: "ERROR",
      status: 500,
      error: { name: "TypeError", message: "boom" },
    });
    const error = collected.parsed()[0]?.error as { stack: string };
    expect(error.stack).toContain("TypeError: boom");
  });
});
