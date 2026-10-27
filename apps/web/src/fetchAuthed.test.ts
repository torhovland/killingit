import { afterEach, describe, expect, it } from "bun:test";
import type { AuthState } from "./auth/auth0";
import { fetchFileAuthed, fetchJsonAuthed } from "./fetchAuthed";
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

describe("fetchFileAuthed", () => {
  let originalFetch: typeof fetch;
  let captured: RequestInit[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured = [];
  });

  function stubFetch(...responses: Response[]): void {
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      captured.push(init ?? {});
      const response = responses.shift() ?? new Response("zwo");
      return Promise.resolve(response);
    }) as unknown as typeof fetch;
  }

  it("returns the file and the server's filename", async () => {
    stubFetch(
      new Response("<workout_file/>", {
        headers: {
          "content-type": "application/xml",
          "content-disposition":
            'attachment; filename="2026-10-21-sweet-spot.zwo"',
        },
      }),
    );
    const auth = fakeAuth(() => Promise.resolve("test-token"));

    const result = await fetchFileAuthed(
      "http://api/coaching/plan/workouts/2026-10-21",
      auth,
    );

    expect(result.filename).toBe("2026-10-21-sweet-spot.zwo");
    expect(await result.blob.text()).toBe("<workout_file/>");
    expect((captured[0]?.headers as Headers).get("authorization")).toBe(
      "Bearer test-token",
    );
  });

  it("reads a UTF-8 filename and returns null when none is supplied", async () => {
    stubFetch(
      new Response("zwo", {
        headers: {
          "content-disposition":
            "attachment; filename*=UTF-8''2026-10-21-%C3%B8kt.zwo",
        },
      }),
      new Response("zwo"),
    );
    const auth = fakeAuth(() => Promise.resolve("test-token"));

    const named = await fetchFileAuthed("http://api/file", auth);
    const unnamed = await fetchFileAuthed("http://api/file", auth);

    expect(named.filename).toBe("2026-10-21-økt.zwo");
    expect(unnamed.filename).toBeNull();
  });

  it("renews the token once and retries a 401", async () => {
    stubFetch(
      new Response("Unauthorized", { status: 401 }),
      new Response("zwo", { headers: { "content-type": "application/xml" } }),
    );
    const calls: Array<{ forceRefresh?: boolean } | undefined> = [];
    const auth = fakeAuth((options) => {
      calls.push(options);
      return Promise.resolve(
        options?.forceRefresh ? "fresh-token" : "stale-token",
      );
    });

    const result = await fetchFileAuthed("http://api/file", auth);

    expect(await result.blob.text()).toBe("zwo");
    expect(calls).toEqual([undefined, { forceRefresh: true }]);
    expect((captured[1]?.headers as Headers).get("authorization")).toBe(
      "Bearer fresh-token",
    );
  });

  it("surfaces non-401 failures as ApiError with the server detail", async () => {
    stubFetch(new Response("No workout", { status: 404 }));
    const auth = fakeAuth(() => Promise.resolve("test-token"));

    let caught: unknown;
    try {
      await fetchFileAuthed("http://api/file", auth);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(404);
    expect((caught as Error).message).toContain("No workout");
  });
});
