import { afterEach, describe, expect, it } from "bun:test";
import type { AuthState } from "./auth/auth0";
import { fetchJsonAuthed } from "./fetchAuthed";

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
  let captured: RequestInit | undefined;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch() {
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      captured = init;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  }

  it("attaches a bearer token when the user is authenticated", async () => {
    stubFetch();
    const auth = fakeAuth(() => Promise.resolve("test-token"));

    const result = await fetchJsonAuthed<{ ok: boolean }>(
      "http://api/me",
      auth,
    );

    expect(result).toEqual({ ok: true });
    const headers = captured?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer test-token");
  });

  it("does not attach a token when getToken returns undefined", async () => {
    stubFetch();
    const auth = fakeAuth(() => Promise.resolve(undefined));

    await fetchJsonAuthed<{ ok: boolean }>("http://api/me", auth);

    const headers = captured?.headers as Headers;
    expect(headers.get("authorization")).toBeNull();
  });
});
