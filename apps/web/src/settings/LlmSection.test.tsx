import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LlmCatalogModel, LlmSettings } from "@killingit/shared";
import type { AuthState } from "../auth";
import { discouragedMessage } from "../llm/catalogFilters";
import { formatDateTime } from "../timeZone";
import { TimeZoneProvider } from "../TimeZoneContext";

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

afterAll(() => {
  mock.restore();
});

const { LlmSection } = await import("./LlmSection");
const { AppStatusProvider } = await import("../AppStatus");

function model(overrides: Partial<LlmCatalogModel> = {}): LlmCatalogModel {
  return {
    id: "test/model",
    name: "Test Model",
    retired: false,
    discouraged: false,
    ability: "A",
    speed: "A",
    cost: "A",
    benchmarkScore: 11,
    benchmarkTimeMs: 10_000,
    benchmarkCostUsd: 0.01,
    benchmarkedAt: "2026-10-31T15:40:52.865Z",
    ...overrides,
  };
}

function settings(overrides: Partial<LlmSettings> = {}): LlmSettings {
  return {
    configured: false,
    provider: "openrouter",
    model: null,
    seasonModel: null,
    dailyModel: null,
    ...overrides,
  };
}

const ALPHA = model({ id: "provider/alpha", name: "Alpha" });
const BETA = model({ id: "provider/beta", name: "Beta" });
const GAMMA = model({ id: "provider/gamma", name: "Gamma" });

const originalFetch = globalThis.fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubCatalog(models: LlmCatalogModel[]): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/llm/catalog")) {
      return Promise.resolve(json({ models }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

/**
 * Stubs the catalog load and the settings save, recording each saved body and
 * answering with the settings the server stored.
 */
function stubApi(options: {
  models: LlmCatalogModel[];
  saved: LlmSettings;
  bodies: unknown[];
}): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/llm/catalog")) {
      return Promise.resolve(json({ models: options.models }));
    }
    if (url.includes("/api/llm/settings") && init?.method === "PUT") {
      const body = init.body;
      if (typeof body !== "string") {
        throw new Error("The saved settings are not a JSON string");
      }
      options.bodies.push(JSON.parse(body));
      return Promise.resolve(json(options.saved));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** The model picker as the Settings page mounts it. */
function section(
  value: LlmSettings,
  onSaved: (saved: LlmSettings) => void = () => undefined,
) {
  return (
    <AppStatusProvider>
      <LlmSection settings={value} onSaved={onSaved} isAdmin={false} />
    </AppStatusProvider>
  );
}

/** The radio for one model in one role, once the catalog has loaded. */
async function radio(
  name: string,
  role: "season planning" | "day-to-day prompts",
): Promise<HTMLInputElement> {
  const element = await screen.findByRole("radio", {
    name: `Use ${name} for ${role}`,
  });
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("The model choice is not a radio input");
  }
  return element;
}

/** The model names in the season column, in the order the table shows them. */
function seasonOrder(): Array<string | null> {
  return screen
    .getAllByRole("radio", { name: /^Use .+ for season planning$/ })
    .map((element) => element.getAttribute("aria-label"));
}

describe("LlmSection", () => {
  it("keeps a local choice while the saved settings are unchanged", async () => {
    const user = userEvent.setup();
    stubCatalog([ALPHA, BETA]);
    const { rerender } = render(section(settings({ model: ALPHA.id })));
    expect((await radio(ALPHA.name, "season planning")).checked).toBe(true);

    await user.click(await radio(BETA.name, "season planning"));
    rerender(section(settings({ model: ALPHA.id })));

    expect((await radio(BETA.name, "season planning")).checked).toBe(true);
    expect((await radio(ALPHA.name, "season planning")).checked).toBe(false);
  });

  it("follows the saved selection after a later settings change", async () => {
    const user = userEvent.setup();
    stubCatalog([ALPHA, BETA, GAMMA]);
    const { rerender } = render(section(settings({ model: ALPHA.id })));
    await radio(ALPHA.name, "season planning");
    await user.click(await radio(BETA.name, "season planning"));

    // The key save answers with the models the server actually stored.
    rerender(
      section(
        settings({
          configured: true,
          seasonModel: GAMMA.id,
          dailyModel: GAMMA.id,
        }),
      ),
    );

    expect((await radio(GAMMA.name, "season planning")).checked).toBe(true);
    expect((await radio(GAMMA.name, "day-to-day prompts")).checked).toBe(true);
    expect((await radio(BETA.name, "season planning")).checked).toBe(false);
  });

  it("falls back to the single stored model for both roles", async () => {
    stubCatalog([ALPHA, BETA]);
    render(section(settings({ model: ALPHA.id })));

    expect((await radio(ALPHA.name, "season planning")).checked).toBe(true);
    expect((await radio(ALPHA.name, "day-to-day prompts")).checked).toBe(true);
  });

  it("hides a model below a grade filter until the filter loosens", async () => {
    const user = userEvent.setup();
    const weak = model({ id: "provider/weak", name: "Weak", ability: "C" });
    stubCatalog([ALPHA, weak]);
    render(section(settings()));

    await radio(ALPHA.name, "season planning");
    expect(
      screen.queryByRole("radio", {
        name: `Use ${weak.name} for season planning`,
      }),
    ).toBe(null);

    await user.selectOptions(screen.getByLabelText("Ability at least"), "C");
    expect((await radio(weak.name, "season planning")).checked).toBe(false);
  });

  it("keeps a selected retired model visible and says it must be replaced", async () => {
    const retired = model({
      id: "provider/old",
      name: "Old Timer",
      retired: true,
    });
    const unselectedRetired = model({
      id: "provider/older",
      name: "Dropped",
      retired: true,
    });
    stubCatalog([retired, unselectedRetired, ALPHA]);
    render(section(settings({ model: retired.id })));

    expect((await radio(retired.name, "season planning")).checked).toBe(true);
    expect(
      screen.queryByRole("radio", {
        name: `Use ${unselectedRetired.name} for season planning`,
      }),
    ).toBe(null);
    expect(
      screen.getByText(
        "Old Timer is retired. Choose another model before running the coach.",
      ),
    ).toBeTruthy();
  });

  it("directs a deleted selected model to Settings", async () => {
    stubCatalog([ALPHA]);
    render(section(settings({ model: "provider/deleted" })));

    expect(
      await screen.findByText(
        "provider/deleted is no longer available. Choose another model before running the coach.",
      ),
    ).toBeTruthy();
  });

  it("warns below the table about a discouraged selection", async () => {
    const discouraged = model({
      id: "provider/slow",
      name: "Slow Coach",
      ability: "C",
      discouraged: true,
    });
    stubCatalog([discouraged, ALPHA]);
    render(section(settings({ model: discouraged.id })));

    await radio(discouraged.name, "season planning");

    expect(screen.getByText(discouragedMessage(discouraged.name))).toBeTruthy();
  });

  it("sorts the table by the clicked header and reverses on a second click", async () => {
    const user = userEvent.setup();
    stubCatalog([ALPHA, BETA, GAMMA]);
    render(section(settings()));

    await radio(ALPHA.name, "season planning");
    expect(seasonOrder()).toEqual([
      "Use Alpha for season planning",
      "Use Beta for season planning",
      "Use Gamma for season planning",
    ]);

    await user.click(screen.getByRole("button", { name: "Model" }));
    expect(seasonOrder()).toEqual([
      "Use Alpha for season planning",
      "Use Beta for season planning",
      "Use Gamma for season planning",
    ]);
    expect(
      screen
        .getByRole("columnheader", { name: "Model" })
        .getAttribute("aria-sort"),
    ).toBe("ascending");

    await user.click(screen.getByRole("button", { name: "Model" }));
    expect(seasonOrder()).toEqual([
      "Use Gamma for season planning",
      "Use Beta for season planning",
      "Use Alpha for season planning",
    ]);
    expect(
      screen
        .getByRole("columnheader", { name: "Model" })
        .getAttribute("aria-sort"),
    ).toBe("descending");
  });

  it("saves both choices as soon as a radio is clicked once a key is stored", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const stored = settings({
      configured: true,
      seasonModel: BETA.id,
      dailyModel: ALPHA.id,
    });
    stubApi({ models: [ALPHA, BETA], saved: stored, bodies });
    const saved: LlmSettings[] = [];
    render(
      section(
        settings({
          configured: true,
          seasonModel: ALPHA.id,
          dailyModel: ALPHA.id,
        }),
        (value) => saved.push(value),
      ),
    );

    await user.click(await radio(BETA.name, "season planning"));

    await waitFor(() =>
      expect(bodies).toEqual([{ seasonModel: BETA.id, dailyModel: ALPHA.id }]),
    );
    await waitFor(() => expect(saved).toEqual([stored]));
    await waitFor(() =>
      expect(screen.queryByText("Saving model choices…")).toBe(null),
    );
  });

  it("keeps the choices local while no key is stored", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    stubApi({
      models: [ALPHA, BETA],
      saved: settings({ configured: true }),
      bodies,
    });
    render(section(settings()));

    await user.click(await radio(BETA.name, "season planning"));

    expect(bodies).toEqual([]);
    expect((await radio(BETA.name, "season planning")).checked).toBe(true);
  });

  it("formats the last-scored time in the account's zone for an admin", async () => {
    const scoredAt = "2026-10-31T15:40:52.865Z";
    const zone = "Pacific/Kiritimati";
    stubCatalog([model({ benchmarkedAt: scoredAt })]);
    render(
      <AppStatusProvider>
        <TimeZoneProvider timeZone={zone}>
          <LlmSection
            settings={settings()}
            onSaved={() => undefined}
            isAdmin={true}
          />
        </TimeZoneProvider>
      </AppStatusProvider>,
    );

    expect(
      await screen.findByText(formatDateTime(scoredAt, zone)),
    ).toBeTruthy();
    expect(screen.queryByText(formatDateTime(scoredAt, "UTC"))).toBe(null);
  });
});
