import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalyzedActivitiesResponse } from "@killingit/shared";
import { saveCachedActivities } from "./activityCache";
import { AppStatusProvider } from "./AppStatus";
import type { AuthState } from "./auth";
import { useActivityFeed } from "./useActivityFeed";

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve(undefined),
};

function feed(...names: string[]): AnalyzedActivitiesResponse {
  return {
    model: null,
    activities: names.map((name, index) => ({
      id: index + 1,
      name,
      type: "running",
      startDate: "2026-10-01T06:30:00Z",
      distance: 5000,
      movingTime: 1500,
      elapsedTime: 1600,
      totalElevationGain: 55,
      sampleCount: 0,
      samples: [],
      analysis: null,
      analysisError: null,
      programAnalysis: null,
      comment: null,
      coachReply: null,
    })),
  };
}

function FeedProbe() {
  const feedState = useActivityFeed(auth, "Europe/Oslo");
  return (
    <div>
      <p data-testid="names">
        {feedState.data === null
          ? "none"
          : feedState.data.activities
              .map((activity) => activity.name)
              .join(",")}
      </p>
      <p data-testid="syncing">{String(feedState.syncing)}</p>
      <p data-testid="error">{feedState.error ?? "none"}</p>
      <button type="button" onClick={() => void feedState.loadAnalyses()}>
        Sync
      </button>
    </div>
  );
}

function renderFeed() {
  render(
    <AppStatusProvider>
      <FeedProbe />
    </AppStatusProvider>,
  );
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

describe("useActivityFeed", () => {
  it("seeds the feed from the account's browser cache", () => {
    saveCachedActivities("user-1", feed("Morning Run"));

    renderFeed();

    expect(screen.getByTestId("names").textContent).toBe("Morning Run");
  });

  it("starts empty when the account has no cached feed", () => {
    renderFeed();

    expect(screen.getByTestId("names").textContent).toBe("none");
  });

  it("replaces the feed with the live sync and caches it", async () => {
    const user = userEvent.setup();
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(feed("Morning Run", "Evening Ride")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )) as unknown as typeof fetch;
    renderFeed();

    await user.click(screen.getByRole("button", { name: "Sync" }));

    expect(await screen.findByText("Morning Run,Evening Ride")).toBeDefined();
    expect(screen.getByTestId("syncing").textContent).toBe("false");
    const cached = localStorage.getItem("killingit.activities.v1:user-1");
    expect(cached).toContain("Evening Ride");
  });

  it("shows a failed sync without losing the feed already on screen", async () => {
    const user = userEvent.setup();
    saveCachedActivities("user-1", feed("Morning Run"));
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "internal_error", message: "Sync failed" },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
      )) as unknown as typeof fetch;
    renderFeed();

    await user.click(screen.getByRole("button", { name: "Sync" }));

    expect(await screen.findByText("Sync failed")).toBeDefined();
    expect(screen.getByTestId("names").textContent).toBe("Morning Run");
    expect(screen.getByTestId("syncing").textContent).toBe("false");
  });
});
