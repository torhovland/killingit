import { afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LlmCatalogModel, LlmSettings } from "@killingit/shared";
import type { AuthState } from "./auth";
import type { LlmModelFilters } from "./LlmSection";

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

const { LlmSection, compareModels, discouragedMessage, modelMatchesFilters } =
  await import("./LlmSection");
const { AppStatusProvider } = await import("./AppStatus");

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

function filters(overrides: Partial<LlmModelFilters> = {}): LlmModelFilters {
  return {
    includeUngraded: true,
    showDiscouraged: false,
    minAbility: "B",
    minSpeed: "D",
    minCost: "D",
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

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** The model picker as the Settings page mounts it. */
function section(value: LlmSettings) {
  return (
    <AppStatusProvider>
      <LlmSection settings={value} onSaved={() => undefined} isAdmin={false} />
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

describe("modelMatchesFilters", () => {
  it("lets an ungraded grade through only when the box is checked", () => {
    const ungraded = model({ ability: "?" });

    expect(modelMatchesFilters(ungraded, filters())).toBe(true);
    expect(
      modelMatchesFilters(ungraded, filters({ includeUngraded: false })),
    ).toBe(false);
  });

  it("still applies the other grade filters to an ungraded model", () => {
    const ungradedAbility = model({ ability: "?", cost: "F" });

    expect(modelMatchesFilters(ungradedAbility, filters())).toBe(false);
    expect(
      modelMatchesFilters(ungradedAbility, filters({ minCost: "F" })),
    ).toBe(true);
  });

  it("handles each ungraded grade independently", () => {
    const ungradedSpeed = model({ speed: "?" });

    expect(modelMatchesFilters(ungradedSpeed, filters())).toBe(true);
    expect(
      modelMatchesFilters(ungradedSpeed, filters({ includeUngraded: false })),
    ).toBe(false);
  });

  it("hides discouraged models unless the box is checked", () => {
    const discouraged = model({ discouraged: true });

    expect(modelMatchesFilters(discouraged, filters())).toBe(false);
    expect(
      modelMatchesFilters(discouraged, filters({ showDiscouraged: true })),
    ).toBe(true);
  });

  it("applies the grade minimums", () => {
    expect(modelMatchesFilters(model({ ability: "C" }), filters())).toBe(false);
    expect(modelMatchesFilters(model({ ability: "B" }), filters())).toBe(true);
  });
});

describe("discouragedMessage", () => {
  it("names the model and tells the athlete to choose another", () => {
    expect(
      discouragedMessage(
        "Google: Nano Banana Pro (Gemini 3 Pro Image Preview)",
      ),
    ).toBe(
      "Google: Nano Banana Pro (Gemini 3 Pro Image Preview) is discouraged. You should choose another model before running the coach.",
    );
  });
});

describe("compareModels", () => {
  it("orders the primary key in the requested direction", () => {
    const a = model({ id: "a", ability: "A" });
    const b = model({ id: "b", ability: "B" });

    expect(compareModels(a, b, "ability", "desc")).toBeLessThan(0);
    expect(compareModels(a, b, "ability", "asc")).toBeGreaterThan(0);
  });

  it("sorts by last scored, keeping unscored models last", () => {
    const older = model({
      id: "older",
      name: "Older",
      benchmarkedAt: "2026-10-01T08:00:00.000Z",
    });
    const newer = model({
      id: "newer",
      name: "Newer",
      benchmarkedAt: "2026-10-31T08:00:00.000Z",
    });
    const unscored = model({
      id: "unscored",
      name: "Unscored",
      benchmarkedAt: null,
    });

    expect(
      [older, unscored, newer]
        .sort((a, b) => compareModels(a, b, "benchmarkedAt", "desc"))
        .map((entry) => entry.name),
    ).toEqual(["Newer", "Older", "Unscored"]);
    expect(
      [older, unscored, newer]
        .sort((a, b) => compareModels(a, b, "benchmarkedAt", "asc"))
        .map((entry) => entry.name),
    ).toEqual(["Older", "Newer", "Unscored"]);
  });

  it("uses ascending model name for ties in both directions", () => {
    const a = model({ id: "a", name: "Alpha", ability: "A" });
    const b = model({ id: "b", name: "Beta", ability: "A" });

    expect(compareModels(a, b, "ability", "desc")).toBeLessThan(0);
    expect(compareModels(a, b, "ability", "asc")).toBeLessThan(0);
  });

  it("uses ascending model name for ties on discouraged", () => {
    const a = model({ id: "a", name: "Alpha", discouraged: false });
    const b = model({ id: "b", name: "Beta", discouraged: false });

    expect(compareModels(a, b, "discouraged", "desc")).toBeLessThan(0);
    expect(compareModels(b, a, "discouraged", "desc")).toBeGreaterThan(0);
  });
});

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
});
