import { afterEach, describe, expect, it } from "bun:test";
import type { AuthState } from "./auth/auth0";
import { fetchJsonAuthed } from "./fetchAuthed";
import { ApiError } from "./fetchJson";

function fakeAuth(getToken: AuthState["getToken"]): AuthState {
  return {
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getToken,
  };
}

describe("fetchJsonAuthed", () => {
  let originalFetch: typeof fetch;
  let captured: RequestInit[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured = [];
  });

  function stubFetch(...responses: Response[]) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      captured.push(init ?? {});
      const response = responses.shift() ?? jsonResponse({ ok: true }, 200);
      return Promise.resolve(response);
    }) as unknown as typeof fetch;
  }

  function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("attaches a bearer token when the user is signed in", async () => {
    stubFetch();
    const auth = fakeAuth(() => Promise.resolve("test-token"));

    const result = await fetchJsonAuthed<{ ok: boolean }>(
      "http://api/me",
      auth,
    );

    expect(result).toEqual({ ok: true });
    const headers = captured[0]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer test-token");
  });

  it("does not attach a token when getToken returns undefined", async () => {
    stubFetch();
    const auth = fakeAuth(() => Promise.resolve(undefined));

    await fetchJsonAuthed<{ ok: boolean }>("http://api/me", auth);

    const headers = captured[0]?.headers as Headers;
    expect(headers.get("authorization")).toBeNull();
  });

  it("renews once and retries when the API rejects the cached token", async () => {
    stubFetch(
      new Response("Unauthorized", { status: 401 }),
      jsonResponse({ ok: true }, 200),
    );
    const calls: Array<{ forceRefresh?: boolean } | undefined> = [];
    const auth = fakeAuth((options) => {
      calls.push(options);
      return Promise.resolve(
        options?.forceRefresh ? "fresh-token" : "stale-token",
      );
    });

    const result = await fetchJsonAuthed<{ ok: boolean }>(
      "http://api/me",
      auth,
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([undefined, { forceRefresh: true }]);
    expect(captured).toHaveLength(2);
    expect((captured[1]?.headers as Headers).get("authorization")).toBe(
      "Bearer fresh-token",
    );
  });

  it("does not retry other API failures", async () => {
    stubFetch(new Response("Server error", { status: 500 }));
    const auth = fakeAuth(() => Promise.resolve("test-token"));

    let caught: unknown;
    try {
      await fetchJsonAuthed<{ ok: boolean }>("http://api/me", auth);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(captured).toHaveLength(1);
  });

  it("surfaces the original 401 when a refresh returns no token", async () => {
    stubFetch(new Response("Unauthorized", { status: 401 }));
    const auth = fakeAuth((options) =>
      Promise.resolve(options?.forceRefresh ? undefined : "stale-token"),
    );

    let caught: unknown;
    try {
      await fetchJsonAuthed<{ ok: boolean }>("http://api/me", auth);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(captured).toHaveLength(1);
  });
});
