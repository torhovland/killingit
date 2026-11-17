import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import * as Sentry from "@sentry/react";
import type { ReactNode } from "react";
import { AppStatusProvider } from "./AppStatus";
import type { AuthState } from "./auth";
import { useWeeklyNote } from "./useWeeklyNote";

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve(undefined),
};

const originalFetch = globalThis.fetch;
let captureException: Mock<typeof Sentry.captureException> | undefined;

afterEach(() => {
  globalThis.fetch = originalFetch;
  captureException?.mockRestore();
  captureException = undefined;
});

function wrapper({ children }: { children: ReactNode }) {
  return <AppStatusProvider>{children}</AppStatusProvider>;
}

describe("useWeeklyNote", () => {
  it("reports a failed load without blocking the dashboard", async () => {
    const capture = spyOn(Sentry, "captureException");
    captureException = capture;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "internal_error", message: "Notes are down" },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
      )) as unknown as typeof fetch;

    const { result } = renderHook(() => useWeeklyNote(auth, "Europe/Oslo"), {
      wrapper,
    });

    await waitFor(() => expect(capture).toHaveBeenCalled());
    expect(result.current.error).toBeNull();
    expect(result.current.note).toBe("");
  });
});
