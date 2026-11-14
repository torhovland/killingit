import { afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AthleteLocation } from "@killingit/shared";
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

const { LocationSection } = await import("./LocationSection");

const OSLO: AthleteLocation = {
  latitude: 59.91,
  longitude: 10.75,
  name: "Oslo, Norway",
};
const TRONDHEIM: AthleteLocation = {
  latitude: 63.43,
  longitude: 10.39,
  name: "Trondheim, Norway",
};
const BERGEN = { latitude: 60.39, longitude: 5.32, name: "Bergen, Norway" };

const originalFetch = globalThis.fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Answers the address search with Bergen regardless of the query. */
function stubGeocode(): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/weather/geocode")) {
      return Promise.resolve(
        json({
          results: [
            {
              name: "Bergen",
              latitude: BERGEN.latitude,
              longitude: BERGEN.longitude,
              country: "Norway",
              admin1: null,
              city: null,
            },
          ],
        }),
      );
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Searches for and selects Bergen, leaving the saved Oslo location unchanged. */
async function chooseBergen(): Promise<void> {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("searchbox", { name: "Find an address" }),
    "Bergen",
  );
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.click(
    await screen.findByRole("button", { name: "Bergen, Norway" }),
  );
}

describe("LocationSection", () => {
  it("shows the map and address search when no location is set", () => {
    render(<LocationSection location={null} onChanged={() => undefined} />);

    expect(screen.getByText("Find an address")).toBeDefined();
    expect(screen.getByRole("button", { name: "Search" })).toBeDefined();
    expect(screen.getByTestId("location-map")).toBeDefined();
    expect(screen.getByText(/No location set/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Clear location" })).toBeNull();
  });

  it("shows a saved location and offers to clear it", () => {
    render(<LocationSection location={OSLO} onChanged={() => undefined} />);

    expect(screen.getByText(/Oslo, Norway/)).toBeDefined();
    expect(screen.getByText(/59.9100, 10.7500/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Clear location" }),
    ).toBeDefined();
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeDefined();
    expect(screen.getByText("Open-Meteo")).toBeDefined();
    expect(screen.getByText("Yr.no")).toBeDefined();
  });

  it("keeps an unsaved draft when the saved location is unchanged", async () => {
    stubGeocode();
    const { rerender } = render(
      <LocationSection location={OSLO} onChanged={() => undefined} />,
    );
    await chooseBergen();
    expect(screen.getByTestId("location-summary").textContent).toContain(
      "60.3900, 5.3200",
    );

    // A parent re-render with the same saved location, even as a new object,
    // must not throw the athlete's unsaved choice away.
    rerender(
      <LocationSection location={{ ...OSLO }} onChanged={() => undefined} />,
    );

    expect(screen.getByTestId("location-summary").textContent).toContain(
      "60.3900, 5.3200",
    );
  });

  it("takes a genuinely changed saved location over the draft", async () => {
    stubGeocode();
    const { rerender } = render(
      <LocationSection location={OSLO} onChanged={() => undefined} />,
    );
    await chooseBergen();

    rerender(
      <LocationSection location={TRONDHEIM} onChanged={() => undefined} />,
    );

    expect(screen.getByTestId("location-summary").textContent).toContain(
      "63.4300, 10.3900",
    );
    expect(screen.getByTestId("location-summary").textContent).not.toContain(
      "60.3900, 5.3200",
    );
  });
});
