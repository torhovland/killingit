import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import * as Sentry from "@sentry/react";
import { subscribeApiOutdated } from "./apiVersion";
import { ApiError, fetchJson } from "./fetchJson";

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

  it("forwards the abort signal to the native fetch", async () => {
    addBreadcrumb = spyOn(Sentry, "addBreadcrumb");
    originalFetch = globalThis.fetch;
    const controller = new AbortController();
    let capturedSignal: AbortSignal | null | undefined;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await fetchJson<unknown>("http://api/health", {
        signal: controller.signal,
      });
    } catch (error) {
      thrown = error;
    }

    expect(capturedSignal).toBe(controller.signal);
    expect((thrown as Error).name).toBe("AbortError");
    // An abort is not a request outcome, so it records no Sentry breadcrumb.
    expect(addBreadcrumb).toHaveBeenCalledTimes(0);
  });

  it("throws on a non-2xx response", async () => {
    stubFetch(new Response("nope", { status: 500 }));

    let thrown: unknown;
    try {
      await fetchJson<unknown>("http://api/greet");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(500);
    expect((thrown as Error).message).toMatch(/failed: 500/);
    expect((thrown as Error).message).toContain("nope");
  });

  it("shows the server's message from the error contract", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          error: {
            code: "validation_failed",
            message: "The request is not valid",
            details: { issues: [{ path: ["name"], message: "Required" }] },
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    let thrown: unknown;
    try {
      await fetchJson<unknown>("http://api/items");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const error = thrown as ApiError;
    expect(error.message).toBe("The request is not valid");
    expect(error.status).toBe(400);
    expect(error.code).toBe("validation_failed");
    expect(error.details).toEqual({
      issues: [{ path: ["name"], message: "Required" }],
    });
  });

  it("reports a refused contract version before throwing", async () => {
    stubFetch(
      new Response('{"error":"api_version_mismatch"}', {
        status: 426,
        headers: { "content-type": "application/json" },
      }),
    );
    let mismatches = 0;
    const unsubscribe = subscribeApiOutdated(() => {
      mismatches += 1;
    });

    let thrown: unknown;
    try {
      await fetchJson<unknown>("http://api/me");
    } catch (e) {
      thrown = e;
    } finally {
      unsubscribe();
    }

    expect((thrown as ApiError).status).toBe(426);
    expect(mismatches).toBe(1);
  });
});
