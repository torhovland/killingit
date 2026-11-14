import { afterEach, describe, expect, it, mock } from "bun:test";
import type { CurrentUser } from "@killingit/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthState } from "../auth";

const { SessionExpiredError } = await import("../auth/session");

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

await mock.module("../auth", () => ({
  SessionExpiredError,
  useAuth: () => auth,
}));

const { AppStatusProvider } = await import("../AppStatus");
const { CurrentUserProvider } = await import("../CurrentUserProvider");
const { PlanGenerationProvider } = await import("../PlanGenerationProvider");
const { PwaProvider } = await import("../PwaContext");
const { SettingsPage } = await import("./SettingsPage");
const { TimeZoneProvider } = await import("../TimeZoneContext");

const OSLO = {
  latitude: 59.91,
  longitude: 10.75,
  name: "Oslo, Norway",
};

const ATHLETE: CurrentUser = {
  sub: "user-1",
  role: "member",
  timezone: "Europe/Oslo",
  location: OSLO,
  dietAdvice: false,
};

const originalFetch = globalThis.fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A stored plan without a season, which is enough for the settings actions. */
const EMPTY_PLAN = {
  plan: null,
  generatedAt: null,
  generation: {
    status: "idle",
    step: null,
    progress: 0,
    error: null,
    runId: null,
    updatedAt: "2026-11-14T00:00:00.000Z",
  },
  stale: false,
  pending: {
    initial: true,
    day: true,
    week: true,
    block: true,
    tomorrow: false,
    nextWeek: false,
    nextBlock: false,
    dietProgress: false,
  },
  thresholds: [],
  events: [],
};

/** Answers every settings-page request and records the `/api/me` saves. */
function stubSettingsServer(): Array<Record<string, unknown>> {
  let user = ATHLETE;
  const patches: Array<Record<string, unknown>> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/me")) {
      if ((init?.method ?? "GET") === "PATCH") {
        const body = init?.body;
        if (typeof body !== "string") {
          return Promise.reject(new Error("Expected a JSON string body"));
        }
        const patch = JSON.parse(body) as Record<string, unknown>;
        patches.push(patch);
        user = { ...user, ...patch };
      }
      return Promise.resolve(json(user));
    }
    if (url.includes("/api/garmin/status")) {
      return Promise.resolve(json({ connected: false }));
    }
    if (url.includes("/api/llm/settings")) {
      return Promise.resolve(
        json({
          configured: false,
          provider: "openrouter",
          model: null,
          seasonModel: null,
          dailyModel: null,
        }),
      );
    }
    if (url.includes("/api/llm/catalog")) {
      return Promise.resolve(json({ models: [] }));
    }
    if (url.includes("/api/coaching/plan")) {
      return Promise.resolve(json(EMPTY_PLAN));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
  return patches;
}

function renderSettings() {
  return render(
    <AppStatusProvider>
      <PwaProvider>
        <TimeZoneProvider timeZone="Europe/Oslo">
          <CurrentUserProvider>
            <PlanGenerationProvider>
              <SettingsPage
                timeZone="Europe/Oslo"
                onTimeZoneChanged={() => undefined}
              />
            </PlanGenerationProvider>
          </CurrentUserProvider>
        </TimeZoneProvider>
      </PwaProvider>
    </AppStatusProvider>,
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SettingsPage", () => {
  it("saves the location through the current-user provider", async () => {
    const patches = stubSettingsServer();
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByText(/Oslo, Norway/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Clear location" }));

    expect(await screen.findByText(/No location set/)).toBeDefined();
    expect(patches).toEqual([{ location: null }]);
  });

  it("saves the diet-advice opt-in through the current-user provider", async () => {
    const patches = stubSettingsServer();
    const user = userEvent.setup();
    renderSettings();

    const checkbox = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: /Give me diet advice and a food log/,
    });
    expect(checkbox.checked).toBe(false);

    await user.click(checkbox);

    const checked = screen.getByRole<HTMLInputElement>("checkbox", {
      name: /Give me diet advice and a food log/,
    });
    await waitFor(() => expect(checked.checked).toBe(true));
    expect(patches).toEqual([{ dietAdvice: true }]);
  });
});
