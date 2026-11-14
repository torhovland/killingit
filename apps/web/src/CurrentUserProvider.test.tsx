import { afterEach, describe, expect, it, mock } from "bun:test";
import type { CurrentUser } from "@killingit/shared";
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

const { AppStatusProvider } = await import("./AppStatus");
const { CurrentUserLoadError, CurrentUserProvider, useCurrentUser } =
  await import("./CurrentUserProvider");

const ATHLETE: CurrentUser = {
  sub: "user-1",
  role: "member",
  timezone: "Europe/Oslo",
  location: null,
  dietAdvice: false,
};

const originalFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface AccountServer {
  user: CurrentUser;
  gets: number;
  patches: Array<Record<string, unknown>>;
  failGets: number;
}

/** A tiny `/api/me` server the tests can change between requests. */
function stubAccount(user: CurrentUser = ATHLETE): AccountServer {
  const server: AccountServer = {
    user,
    gets: 0,
    patches: [],
    failGets: 0,
  };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.includes("/api/me")) {
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }
    const method = init?.method ?? "GET";
    if (method === "PATCH") {
      const body = init?.body;
      if (typeof body !== "string") {
        return Promise.reject(new Error("Expected a JSON string body"));
      }
      const patch = JSON.parse(body) as Record<string, unknown>;
      server.patches.push(patch);
      server.user = { ...server.user, ...patch };
      return Promise.resolve(json(server.user));
    }
    server.gets += 1;
    if (server.failGets > 0) {
      server.failGets -= 1;
      return Promise.resolve(
        json(
          {
            error: {
              code: "internal_error",
              message: "The account could not be loaded",
            },
          },
          500,
        ),
      );
    }
    return Promise.resolve(json(server.user));
  }) as unknown as typeof fetch;
  return server;
}

/** Shows the provider's values and drives `update` and `reload`. */
function Probe() {
  const { user, loading, error, update, reload } = useCurrentUser();
  return (
    <div>
      <p data-testid="timezone">{user?.timezone ?? "none"}</p>
      <p data-testid="diet">{user?.dietAdvice ? "on" : "off"}</p>
      <p data-testid="loading">{loading ? "loading" : "idle"}</p>
      <p data-testid="error">{error ?? "none"}</p>
      <button onClick={() => void update({ dietAdvice: true })}>Enable</button>
      <button onClick={reload}>Reload</button>
      <CurrentUserLoadError />
    </div>
  );
}

function renderProvider() {
  return render(
    <AppStatusProvider>
      <CurrentUserProvider>
        <Probe />
      </CurrentUserProvider>
    </AppStatusProvider>,
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CurrentUserProvider", () => {
  it("loads the signed-in user", async () => {
    stubAccount();
    renderProvider();

    expect(await screen.findByText("Europe/Oslo")).toBeDefined();
    expect(screen.getByTestId("diet").textContent).toBe("off");
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("updates a field without refetching the account", async () => {
    const server = stubAccount();
    const user = userEvent.setup();
    renderProvider();
    await screen.findByText("Europe/Oslo");

    await user.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() =>
      expect(screen.getByTestId("diet").textContent).toBe("on"),
    );
    expect(server.patches).toEqual([{ dietAdvice: true }]);
    expect(server.gets).toBe(1);
  });

  it("shows a failed load and retries it from the error affordance", async () => {
    const server = stubAccount();
    server.failGets = 1;
    const user = userEvent.setup();
    renderProvider();

    const error = await screen.findByTestId("current-user-error");
    expect(error.textContent).toContain("The account could not be loaded");
    expect(server.gets).toBe(1);

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Europe/Oslo")).toBeDefined());
    expect(screen.queryByTestId("current-user-error")).toBeNull();
    expect(server.gets).toBe(2);
  });

  it("reloads the account on request", async () => {
    const server = stubAccount();
    const user = userEvent.setup();
    renderProvider();
    await screen.findByText("Europe/Oslo");

    server.user = { ...server.user, timezone: "Europe/Berlin" };
    await user.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(screen.getByTestId("timezone").textContent).toBe("Europe/Berlin"),
    );
    expect(server.gets).toBe(2);
  });
});
