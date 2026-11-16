import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import * as Sentry from "@sentry/react";
import type { AuthState } from "./auth";
import { useModelCatalogRefresh } from "./useModelCatalogRefresh";

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

const originalFetch = globalThis.fetch;
let captureException: Mock<typeof Sentry.captureException> | undefined;

afterEach(() => {
  globalThis.fetch = originalFetch;
  captureException?.mockRestore();
  captureException = undefined;
});

describe("useModelCatalogRefresh", () => {
  it("asks the API to refresh the catalog for a signed-in page visit", async () => {
    const urls: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      urls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return Promise.resolve(new Response(JSON.stringify({})));
    }) as typeof fetch;

    renderHook(() => useModelCatalogRefresh(auth));

    await waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0]).toContain("/api/llm/models/refresh");
  });

  it("reports a failed refresh without a UI message", async () => {
    const capture = spyOn(Sentry, "captureException");
    captureException = capture;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "internal_error", message: "Catalog is down" },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
      )) as unknown as typeof fetch;

    renderHook(() => useModelCatalogRefresh(auth));

    await waitFor(() => expect(capture).toHaveBeenCalled());
  });

  it("does nothing while signed out", () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify({})));
    }) as unknown as typeof fetch;

    renderHook(() =>
      useModelCatalogRefresh({ ...auth, isAuthenticated: false }),
    );

    expect(calls).toBe(0);
  });
});
