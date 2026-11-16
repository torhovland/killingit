import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CoachPlan,
  CoachPlanResponse,
  PlanGenerateMode,
} from "@killingit/shared";
import type { AuthState } from "./auth";
import type { PlanGenerationOutcome } from "./planGeneration";

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

const { SessionExpiredError } = await import("./auth/session");

await mock.module("./auth", () => ({
  SessionExpiredError,
  useAuth: () => auth,
}));

afterAll(() => {
  mock.restore();
});

interface Generation {
  running: boolean;
  mode: PlanGenerateMode | null;
  start: (mode?: PlanGenerateMode) => Promise<PlanGenerationOutcome>;
  track: () => void;
}

let generation: Generation;

/**
 * Whether this suite's controlled generation replaces the real hook. Other
 * suites load after this file and must see the real provider, so the stub only
 * applies while this suite's own tests are running.
 */
let useControlledGeneration = false;

// Stub only the hook and keep the provider export, which other suites render.
const realPlanGenerationProvider = await import("./PlanGenerationProvider");
// Capture the function itself: the module namespace is live, so reading
// `realPlanGenerationProvider.usePlanGeneration` after the mock would recurse.
const realUsePlanGeneration = realPlanGenerationProvider.usePlanGeneration;

await mock.module("./PlanGenerationProvider", () => ({
  ...realPlanGenerationProvider,
  usePlanGeneration: () => {
    if (!useControlledGeneration) {
      return realUsePlanGeneration();
    }
    return {
      ...generation,
      progress: null,
      latest: null,
      revision: 0,
      error: null,
    };
  },
}));

const { AppStatusProvider } = await import("./AppStatus");
const { PlanRegenerationButtons } = await import("./PlanRegenerationButtons");

/** The buttons read the shared status hook, which registers a header source. */
function renderButtons() {
  return render(
    <AppStatusProvider>
      <PlanRegenerationButtons />
    </AppStatusProvider>,
  );
}

const plan: CoachPlan = {
  season: {
    goal: "Finish the season strong",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    rationale: "Build aerobic fitness.",
    blocks: [
      {
        name: "Base",
        focus: "Aerobic base",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        weekCount: 12,
      },
    ],
  },
  block: {
    name: "Base",
    focus: "Aerobic base",
    startDate: "2026-10-01",
    endDate: "2026-12-01",
    rationale: "Build volume gradually.",
    weeks: [
      {
        number: 1,
        startDate: "2026-09-28",
        focus: "Aerobic base",
        targetLoad: "Easy",
      },
    ],
  },
  week: {
    startDate: "2026-09-28",
    focus: "Aerobic base",
    rationale: "Keep it easy.",
    sessions: [
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ].map((date) => ({
      date,
      day: "Monday",
      type: "rest" as const,
      title: "Rest",
      description: "Rest day.",
      durationMinutes: 0,
      intensity: "rest" as const,
      status: "rest" as const,
    })),
  },
  today: {
    date: "2026-10-01",
    type: "rest",
    title: "Rest",
    description: "Rest day.",
    durationMinutes: 0,
    intensity: "rest",
    alternatives: [],
    rationale: "Rest is part of the plan.",
    optional: false,
    status: "rest",
  },
  tomorrow: null,
  nextWeek: null,
  nextBlock: null,
};

function planResponse(hasSeason: boolean): CoachPlanResponse {
  return {
    plan: hasSeason ? plan : null,
    generatedAt: null,
    generation: {
      status: "idle",
      step: null,
      progress: 0,
      error: null,
      runId: null,
      updatedAt: "2026-11-15T08:00:00.000Z",
    },
    stale: false,
    pending: {
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    },
    thresholds: [],
    events: [],
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The API's 5xx envelope, so a failed status request reports an error. */
function failure(): Promise<Response> {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        error: { code: "internal_error", message: "The API is down" },
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    ),
  );
}

const originalFetch = globalThis.fetch;

interface Setup {
  hasSeason?: boolean;
  garminConnected?: boolean;
  llmConfigured?: boolean;
  /** Fail both status requests, as an unreachable API would. */
  statusesFail?: boolean;
  /** Leave both status requests in flight. */
  statusesPending?: boolean;
}

/** Serves the availability and integration checks the buttons make on mount. */
function stubApi({
  hasSeason = true,
  garminConnected = true,
  llmConfigured = true,
  statusesFail = false,
  statusesPending = false,
}: Setup = {}): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/coaching/plan?today=")) {
      return Promise.resolve(json(planResponse(hasSeason)));
    }
    if (url.includes("/api/garmin/status")) {
      if (statusesPending) {
        return new Promise<Response>(() => undefined);
      }
      if (statusesFail) {
        return failure();
      }
      return Promise.resolve(json({ connected: garminConnected }));
    }
    if (url.includes("/api/llm/settings")) {
      if (statusesPending) {
        return new Promise<Response>(() => undefined);
      }
      if (statusesFail) {
        return failure();
      }
      return Promise.resolve(
        json({
          configured: llmConfigured,
          provider: "openrouter",
          model: null,
        }),
      );
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as typeof fetch;
}

const done: PlanGenerationOutcome = {
  status: "done",
  plan: planResponse(true),
};

beforeEach(() => {
  setSystemTime(new Date("2026-11-15T12:00:00Z"));
  useControlledGeneration = true;
  generation = {
    running: false,
    mode: null,
    start: mock(() => Promise.resolve(done)),
    track: () => undefined,
  };
});

afterEach(() => {
  useControlledGeneration = false;
  globalThis.fetch = originalFetch;
  setSystemTime();
});

describe("PlanRegenerationButtons", () => {
  it("offers only a new season when no season exists", async () => {
    stubApi({ hasSeason: false });
    renderButtons();

    const start = await screen.findByRole("button", {
      name: "Plan a new season",
    });

    expect(start.className).toContain("bg-primary");
    expect(
      screen.queryByRole("button", { name: "Update season plan" }),
    ).toBeNull();
  });

  it("makes updating the primary action when a season exists", async () => {
    stubApi();
    renderButtons();

    const update = await screen.findByRole("button", {
      name: "Update season plan",
    });

    expect(update.className).toContain("bg-primary");
    expect(
      screen.getByRole("button", { name: "Plan a new season" }).className,
    ).not.toContain("bg-primary");
    expect(screen.getByText(/keeps completed blocks/)).toBeDefined();
  });

  it("runs the action that was clicked", async () => {
    const user = userEvent.setup();
    stubApi();
    renderButtons();

    await user.click(
      await screen.findByRole("button", { name: "Plan a new season" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Update season plan" }),
    );

    expect(generation.start).toHaveBeenNthCalledWith(1, "newSeason");
    expect(generation.start).toHaveBeenNthCalledWith(2, "updateSeason");
  });

  it("spins and names the coach on the action that is running", async () => {
    generation.running = true;
    generation.mode = "updateSeason";
    stubApi();
    renderButtons();

    const running = await screen.findByRole("button", {
      name: "Coach is thinking…",
    });

    expect(running.className).toContain("bg-primary");
    expect(running).toHaveProperty("disabled", true);
    expect(screen.getAllByTestId("spinner")).toHaveLength(1);
    // The other action stays identifiable but cannot be started.
    expect(
      screen.getByRole("button", { name: "Plan a new season" }),
    ).toHaveProperty("disabled", true);
  });

  it("spins on a new season when it is the only action", async () => {
    generation.running = true;
    generation.mode = "newSeason";
    stubApi({ hasSeason: false });
    renderButtons();

    expect(
      await screen.findByRole("button", { name: "Coach is thinking…" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Plan a new season" }),
    ).toBeNull();
  });

  it("disables every action while another generation is running", async () => {
    const user = userEvent.setup();
    generation.running = true;
    generation.mode = "auto";
    stubApi();
    renderButtons();

    const update = await screen.findByRole("button", {
      name: "Update season plan",
    });
    const start = screen.getByRole("button", { name: "Plan a new season" });
    expect(update).toHaveProperty("disabled", true);
    expect(start).toHaveProperty("disabled", true);
    // The run was started elsewhere, so no button claims to be the one running.
    expect(
      screen.queryByRole("button", { name: "Coach is thinking…" }),
    ).toBeNull();

    await user.click(update);
    await user.click(start);
    expect(generation.start).not.toHaveBeenCalled();
  });

  it("asks for both integrations when neither is set up", async () => {
    stubApi({ hasSeason: false, garminConnected: false, llmConfigured: false });
    renderButtons();

    expect((await screen.findByRole("status")).textContent).toContain(
      "Set up Garmin and an OpenRouter API key",
    );
  });

  it("asks only for Garmin when OpenRouter is configured", async () => {
    stubApi({ hasSeason: false, garminConnected: false, llmConfigured: true });
    renderButtons();

    expect((await screen.findByRole("status")).textContent).toBe(
      "Set up Garmin in Settings before planning a new season.",
    );
  });

  it("asks only for OpenRouter when Garmin is connected", async () => {
    stubApi({ hasSeason: false, garminConnected: true, llmConfigured: false });
    renderButtons();

    expect((await screen.findByRole("status")).textContent).toBe(
      "Set up an OpenRouter API key in Settings before planning a new season.",
    );
  });

  it("shows no setup notice when both integrations are ready", async () => {
    stubApi({ hasSeason: false });
    renderButtons();

    await screen.findByRole("button", { name: "Plan a new season" });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays open while the setup status is loading", async () => {
    const user = userEvent.setup();
    stubApi({ hasSeason: false, statusesPending: true });
    renderButtons();

    const start = await screen.findByRole("button", {
      name: "Plan a new season",
    });

    expect(screen.queryByRole("status")).toBeNull();

    await user.click(start);
    expect(generation.start).toHaveBeenCalledWith("newSeason");
  });

  it("stays open when the setup status fails", async () => {
    const user = userEvent.setup();
    stubApi({ hasSeason: false, statusesFail: true });
    renderButtons();

    const start = await screen.findByRole("button", {
      name: "Plan a new season",
    });

    expect(screen.queryByRole("status")).toBeNull();

    await user.click(start);
    expect(generation.start).toHaveBeenCalledWith("newSeason");
  });
});
