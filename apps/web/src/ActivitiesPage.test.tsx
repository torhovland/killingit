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

const { ActivitiesPage } = await import("./ActivitiesPage");
const { AppStatusProvider } = await import("./AppStatus");
const { TimeZoneProvider } = await import("./TimeZoneContext");

const MANUAL_ACTIVITY = {
  id: 3,
  startDate: "2026-11-07",
  details: "Indoor climb for 45 minutes",
  coachReply: null,
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

/** Answers the activities page's requests and tracks manual deletions. */
function stubActivitiesServer({
  deleteFails = false,
}: {
  deleteFails?: boolean;
} = {}): { deletions: number } {
  const state = { deletions: 0 };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
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
    if (url.includes("/api/coaching/activities/manual")) {
      if ((init?.method ?? "GET") === "DELETE") {
        state.deletions += 1;
        if (deleteFails) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: "internal_error", message: "Delete failed" },
              }),
              {
                status: 500,
                headers: { "content-type": "application/json" },
              },
            ),
          );
        }
        return Promise.resolve(json({ message: "Deleted", reply: null }));
      }
      return Promise.resolve(
        json({
          manualActivities: state.deletions === 0 ? [MANUAL_ACTIVITY] : [],
        }),
      );
    }
    if (url.includes("/api/coaching/activities/cached")) {
      return Promise.resolve(json({ model: null, activities: [] }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
  return state;
}

function renderPage() {
  render(
    <AppStatusProvider>
      <TimeZoneProvider timeZone="Europe/Oslo">
        <ActivitiesPage />
      </TimeZoneProvider>
    </AppStatusProvider>,
  );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ActivitiesPage", () => {
  it("confirms a manual activity deletion in one dialog", async () => {
    const user = userEvent.setup();
    const server = stubActivitiesServer();
    renderPage();

    expect(
      await screen.findByText(/Indoor climb for 45 minutes/),
    ).toBeDefined();
    const trigger = screen.getByRole("button", { name: "Delete" });
    await user.click(trigger);

    expect(
      screen.getByRole("heading", { name: "Delete this manual activity?" }),
    ).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(server.deletions).toBe(0);

    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(server.deletions).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Indoor climb for 45 minutes/)).toBeNull();
  });

  it("keeps the confirmation open and shows a failed deletion once", async () => {
    const user = userEvent.setup();
    stubActivitiesServer({ deleteFails: true });
    renderPage();
    await screen.findByText(/Indoor climb for 45 minutes/);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    const dialog = await screen.findByRole("dialog");
    expect(
      screen.getByText("Error: Delete failed", { exact: false }),
    ).toBeDefined();
    expect(screen.getAllByText(/Delete failed/).length).toBe(1);
    expect(dialog).toBeDefined();
  });
});
