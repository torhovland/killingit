import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { SessionExpiredError } = await import("../auth/session");

const session = {
  isAuthenticated: true,
  isLoading: false,
  sub: "athlete",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

await mock.module("../auth", () => ({
  SessionExpiredError,
  useAuth: () => session,
}));

afterAll(() => {
  mock.restore();
});

const { AppStatusProvider } = await import("../AppStatus");
const { TimeZoneProvider } = await import("../TimeZoneContext");
const { DailyMeasurementsSection } = await import("./DailyMeasurementsSection");

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

let calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The JSON body a request sent, or null when it carried none. */
function requestBody(init?: RequestInit): unknown {
  return typeof init?.body === "string"
    ? (JSON.parse(init.body) as unknown)
    : null;
}

/** Serves the tracked measures on GET and the saved date on PUT. */
function stubFetch(metrics: string[], saveFailure: string | null = null): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: requestBody(init) });
    if (!url.includes("/api/measurements")) {
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }
    if (method === "PUT") {
      if (saveFailure !== null) {
        return Promise.resolve(
          json(
            { error: { code: "internal_error", message: saveFailure } },
            500,
          ),
        );
      }
      const { date } = requestBody(init) as { date: string };
      return Promise.resolve(json({ date, saved: true }));
    }
    return Promise.resolve(json({ metrics }));
  }) as unknown as typeof fetch;
}

function renderPanel() {
  return render(
    <AppStatusProvider>
      <TimeZoneProvider timeZone="Europe/Oslo">
        <DailyMeasurementsSection />
      </TimeZoneProvider>
    </AppStatusProvider>,
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
});

describe("DailyMeasurementsSection", () => {
  it("stays hidden when the athlete tracks no body measure", async () => {
    stubFetch([]);
    const view = renderPanel();

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(view.container.innerHTML).toBe("");
  });

  it("offers a date and one field per tracked measure", async () => {
    stubFetch(["weight", "bodyFat"]);
    renderPanel();

    expect(await screen.findByText("Daily measurements")).toBeDefined();
    const date = screen.getByTestId<HTMLInputElement>(
      "daily-measurements-date",
    );
    expect(date.type).toBe("date");
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByLabelText("Weight (kg)")).toBeDefined();
    expect(screen.getByLabelText("Body fat (%)")).toBeDefined();
    expect(screen.queryByTestId("daily-measurements-saved")).toBeNull();
  });

  it("shows only the measure the athlete tracks", async () => {
    stubFetch(["bodyFat"]);
    renderPanel();

    expect(await screen.findByLabelText("Body fat (%)")).toBeDefined();
    expect(screen.queryByLabelText("Weight (kg)")).toBeNull();
  });

  it("logs the entered values and confirms the save", async () => {
    stubFetch(["weight", "bodyFat"]);
    const user = userEvent.setup();
    renderPanel();

    const weight = await screen.findByLabelText("Weight (kg)");
    await user.type(weight, "81.4");
    await user.type(screen.getByLabelText("Body fat (%)"), "18.2");
    await user.click(screen.getByRole("button", { name: "Log measurements" }));

    expect(
      (await screen.findByTestId("daily-measurements-saved")).textContent,
    ).toBe("Measurements saved.");
    const body = calls.find((call) => call.method === "PUT")?.body;
    expect(body).toMatchObject({ weightKg: 81.4, bodyFatPercent: 18.2 });
    expect((body as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sends only the fields that were filled in", async () => {
    stubFetch(["weight", "bodyFat"]);
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText("Weight (kg)"), "81.4");
    await user.click(screen.getByRole("button", { name: "Log measurements" }));

    await screen.findByTestId("daily-measurements-saved");
    const body = calls.find((call) => call.method === "PUT")?.body;
    expect(body).toMatchObject({ weightKg: 81.4 });
    expect(body).not.toHaveProperty("bodyFatPercent");
    expect((body as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("shows a save failure without claiming it was saved", async () => {
    stubFetch(["weight"], "The measurement could not be saved");
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText("Weight (kg)"), "81.4");
    await user.click(screen.getByRole("button", { name: "Log measurements" }));

    expect(
      (await screen.findByTestId("daily-measurements-save-error")).textContent,
    ).toContain("The measurement could not be saved");
    expect(screen.queryByTestId("daily-measurements-saved")).toBeNull();
  });
});
