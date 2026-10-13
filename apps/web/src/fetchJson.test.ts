import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import * as Sentry from "@sentry/react";
import { fetchJson } from "./fetchJson";

type AddBreadcrumb = typeof Sentry.addBreadcrumb;

describe("fetchJson", () => {
  let addBreadcrumb: Mock<AddBreadcrumb>;
  let originalFetch: typeof fetch;

  afterEach(() => {
    addBreadcrumb.mockRestore();
    globalThis.fetch = originalFetch;
  });

  function stubFetch(res: Response) {
    addBreadcrumb = spyOn(Sentry, "addBreadcrumb");
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(res)) as unknown as typeof fetch;
  }

  it("returns parsed JSON and records an http breadcrumb on success", async () => {
    stubFetch(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await fetchJson<{ ok: boolean }>("http://api/health");

    expect(result).toEqual({ ok: true });
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb.mock.calls[0]?.[0]).toMatchObject({
      category: "http",
      level: "info",
      message: "GET http://api/health",
    });
  });

  it("throws a context-rich error when the response is not valid JSON", async () => {
    stubFetch(
      new Response("<!doctype html><html>SPA fallback</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    let thrown: unknown;
    try {
      await fetchJson<unknown>("http://api/greet?name=athlete");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(
      /returned invalid JSON \(status 200, text\/html\)/,
    );
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it("throws on a non-2xx response", async () => {
    stubFetch(new Response("nope", { status: 500 }));

    let thrown: unknown;
    try {
      await fetchJson<unknown>("http://api/greet");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/failed: 500/);
  });
});
