import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthState } from "./auth";

const { SessionExpiredError } = await import("./auth/session");

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

await mock.module("./auth", () => ({
  SessionExpiredError,
  useAuth: () => auth,
}));

afterAll(() => {
  mock.restore();
});

const { AppStatusProvider, useAppStatus } = await import("./AppStatus");
const { useStatuses } = await import("./useStatuses");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

interface StatusResponses {
  garmin?: { connected: boolean };
  llm?: { configured: boolean };
  fail?: boolean;
}

/** Answers the two status requests the hook makes, or fails both. */
function stubApi({
  garmin = { connected: true },
  llm = { configured: true },
  fail = false,
}: StatusResponses = {}): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (fail) {
      return Promise.resolve(
        json(
          { error: { code: "internal_error", message: "The API is down" } },
          500,
        ),
      );
    }
    if (url.includes("/api/garmin/status")) {
      return Promise.resolve(json(garmin));
    }
    if (url.includes("/api/llm/settings")) {
      return Promise.resolve(
        json({
          configured: llm.configured,
          provider: "openrouter",
          model: null,
        }),
      );
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

function StatusesProbe({ statusSource }: { statusSource?: string }) {
  const statuses = useStatuses(
    auth,
    statusSource === undefined ? {} : { statusSource },
  );
  return (
    <div>
      <p data-testid="garmin">
        {statuses.loading
          ? "loading"
          : statuses.garmin === null
            ? "none"
            : String(statuses.garmin.connected)}
      </p>
      <p data-testid="llm">
        {statuses.llm === null ? "none" : String(statuses.llm.configured)}
      </p>
      <p data-testid="error">{statuses.error ?? "none"}</p>
      <p data-testid="app-status">{useAppStatus().status}</p>
      <button
        type="button"
        onClick={() =>
          statuses.setData((previous) =>
            previous === null
              ? previous
              : { ...previous, garmin: { connected: false } },
          )
        }
      >
        Disconnect
      </button>
    </div>
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useStatuses", () => {
  it("loads the Garmin and LLM statuses together", async () => {
    stubApi({ garmin: { connected: true }, llm: { configured: false } });

    render(
      <AppStatusProvider>
        <StatusesProbe />
      </AppStatusProvider>,
    );

    expect((await screen.findByTestId("garmin")).textContent).toBe("true");
    expect(screen.getByTestId("llm").textContent).toBe("false");
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("registers the header spinner under the given source", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      await gate;
      if (url.includes("/api/garmin/status")) {
        return json({ connected: true });
      }
      return json({ configured: true, provider: "openrouter", model: null });
    }) as unknown as typeof fetch;

    render(
      <AppStatusProvider>
        <StatusesProbe statusSource="settings-page" />
      </AppStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("app-status").textContent).toBe("loading"),
    );

    release();
    await waitFor(() =>
      expect(screen.getByTestId("app-status").textContent).toBe("idle"),
    );
  });

  it("replaces a status after a save through setData", async () => {
    const user = userEvent.setup();
    stubApi();

    render(
      <AppStatusProvider>
        <StatusesProbe />
      </AppStatusProvider>,
    );

    expect((await screen.findByTestId("garmin")).textContent).toBe("true");

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(screen.getByTestId("garmin").textContent).toBe("false");
  });

  it("surfaces a failed load without inventing statuses", async () => {
    stubApi({ fail: true });

    render(
      <AppStatusProvider>
        <StatusesProbe />
      </AppStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe("The API is down"),
    );
    expect(screen.getByTestId("garmin").textContent).toBe("none");
    expect(screen.getByTestId("llm").textContent).toBe("none");
  });
});
