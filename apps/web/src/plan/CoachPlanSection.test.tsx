import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
  spyOn,
} from "bun:test";
import type { Mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Sentry from "@sentry/react";
import type { CoachPlanResponse } from "@killingit/shared";
import type { AuthState } from "../auth";
import { plan } from "../testFixtures/plan";

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

const { SessionExpiredError } = await import("../auth/session");

await mock.module("../auth", () => ({
  SessionExpiredError,
  useAuth: () => auth,
}));

afterAll(() => {
  mock.restore();
});

const { AppStatusProvider } = await import("../AppStatus");
const { CoachPlanSection } = await import("./CoachPlanSection");
const { PlanGenerationProvider } = await import("./PlanGenerationProvider");
const { TimeZoneProvider } = await import("../TimeZoneContext");

const originalFetch = globalThis.fetch;
type Schedule = (
  handler: TimerHandler,
  timeout?: number,
  ...args: unknown[]
) => number;

const realSetTimeout = globalThis.setTimeout;
const schedule = realSetTimeout.bind(globalThis) as Schedule;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function respond(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(json(body, status));
}

function planResponse(
  overrides: {
    plan?: CoachPlanResponse["plan"];
    stale?: boolean;
    generation?: Partial<CoachPlanResponse["generation"]>;
    pending?: Partial<CoachPlanResponse["pending"]>;
  } = {},
): CoachPlanResponse {
  return {
    plan: overrides.plan === undefined ? plan : overrides.plan,
    generatedAt: null,
    generation: {
      status: "idle",
      step: null,
      progress: 0,
      error: null,
      runId: null,
      updatedAt: "2026-11-15T08:00:00.000Z",
      ...overrides.generation,
    },
    stale: overrides.stale ?? false,
    pending: {
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
      ...overrides.pending,
    },
    thresholds: [],
    events: [],
  };
}

const running = planResponse({
  generation: { status: "running", step: "Building your week", progress: 40 },
});
const done = planResponse({
  generation: { status: "done", step: "Done", progress: 100 },
});

let captureException: Mock<typeof Sentry.captureException> | undefined;

interface Server {
  gets: number;
  urls: string[];
  posts: Array<Record<string, unknown>>;
  reply: (getIndex: number) => Promise<Response>;
}

/** Serves the section's plan reads and the provider's generate POST. */
function stubPlanServer(
  reply: (getIndex: number) => Promise<Response> = () =>
    respond(planResponse()),
  dietReply: () => Promise<Response> = () => respond({ days: [] }),
): Server {
  const server: Server = { gets: 0, urls: [], posts: [], reply };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/diet/summary")) {
      return dietReply();
    }
    if (url.includes("/api/coaching/plan/generate")) {
      if (typeof init?.body !== "string") {
        return Promise.reject(new Error("Expected a JSON request body"));
      }
      server.posts.push(JSON.parse(init.body) as Record<string, unknown>);
      return Promise.resolve(json({}));
    }
    if (url.includes("/api/coaching/plan?today=")) {
      server.urls.push(url);
      const index = server.gets;
      server.gets += 1;
      return server.reply(index);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as typeof fetch;
  return server;
}

function deferred(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function section(
  refreshKey: number,
  {
    ready = true,
    dietAdvice = false,
    onGenerated,
  }: { ready?: boolean; dietAdvice?: boolean; onGenerated?: () => void } = {},
) {
  return (
    <AppStatusProvider>
      <TimeZoneProvider timeZone="UTC">
        <PlanGenerationProvider>
          <CoachPlanSection
            refreshKey={refreshKey}
            ready={ready}
            dietAdvice={dietAdvice}
            {...(onGenerated === undefined ? {} : { onGenerated })}
          />
        </PlanGenerationProvider>
      </TimeZoneProvider>
    </AppStatusProvider>
  );
}

beforeEach(() => {
  setSystemTime(new Date("2026-11-15T12:00:00Z"));
  // The provider's production poll interval is 1.5 s. Shorten only that sleep
  // so a run settles quickly; Testing Library's own timers keep their timing.
  globalThis.setTimeout = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) =>
    schedule(
      handler,
      timeout === 1500 ? 2 : (timeout ?? 0),
      ...args,
    )) as typeof setTimeout;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = realSetTimeout;
  setSystemTime();
  captureException?.mockRestore();
  captureException = undefined;
});

describe("CoachPlanSection", () => {
  it("loads the stored plan for today on mount", async () => {
    const server = stubPlanServer();

    render(section(0));

    expect(await screen.findByTestId("coach-plan-view")).toBeDefined();
    expect(screen.getByTestId("plan-today")).toBeDefined();
    expect(screen.queryByTestId("plan-loading")).toBeNull();
    expect(server.gets).toBe(1);
    expect(server.urls[0]).toContain("today=2026-11-15");
    expect(server.urls[0]).toContain("includeTomorrow=false");
  });

  it("shows a failed load and retries by starting a generation", async () => {
    const user = userEvent.setup();
    const server = stubPlanServer((index) =>
      index === 0
        ? respond(
            {
              error: {
                code: "internal_error",
                message: "The plan could not be loaded",
              },
            },
            500,
          )
        : respond(done),
    );

    render(section(0));

    const error = await screen.findByTestId("plan-error");
    expect(error.textContent).toBe("Error: The plan could not be loaded");
    expect(screen.queryByTestId("coach-plan-view")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]?.mode).toBe("auto");
    // Let the started run settle so no poll outlives this test.
    await waitFor(() => expect(server.gets).toBe(2));
  });

  it("reloads the plan when refreshKey changes", async () => {
    const server = stubPlanServer();

    const view = render(section(0));
    await screen.findByTestId("coach-plan-view");
    expect(server.gets).toBe(1);

    view.rerender(section(1));

    await waitFor(() => expect(server.gets).toBe(2));
    expect(server.urls[1]).toContain("today=2026-11-15");
  });

  it("tracks a generation that is already running on the server", async () => {
    const server = stubPlanServer((index) =>
      index === 0 ? respond(running) : respond(done),
    );

    render(section(0));

    await screen.findByTestId("coach-plan-view");
    // The run is tracked through status reads; it is never started again.
    await waitFor(() => expect(server.gets).toBe(2));
    expect(server.posts).toHaveLength(0);
  });

  it("starts for a stale plan and adopts the newest plan when it finishes", async () => {
    const onGenerated = mock(() => undefined);
    const server = stubPlanServer((index) =>
      index === 0
        ? respond(planResponse({ plan: null, stale: true }))
        : respond(done),
    );

    render(section(0, { onGenerated }));

    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({
      today: "2026-11-15",
      timezone: "UTC",
      mode: "auto",
    });
    expect(await screen.findByTestId("coach-plan-view")).toBeDefined();
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
  });

  it("does not spend a generation on a stale plan until setup is ready", async () => {
    const server = stubPlanServer(() => respond(planResponse({ stale: true })));

    render(section(0, { ready: false }));

    expect(
      await screen.findByText(
        "Connect Garmin and OpenRouter to generate your training plan.",
      ),
    ).toBeDefined();
    await waitFor(() =>
      expect(screen.queryByTestId("plan-loading")).toBeNull(),
    );
    expect(server.posts).toHaveLength(0);
  });

  it("queues a follow-up run when answers change mid-run", async () => {
    const poll = deferred();
    const load = deferred();
    const server = stubPlanServer((index) => {
      if (index === 0) {
        return respond(running);
      }
      if (index === 1) {
        return poll.promise;
      }
      if (index === 2) {
        return load.promise;
      }
      return respond(done);
    });

    const view = render(section(0));
    await screen.findByTestId("coach-plan-view");

    // Reload while the tracked run is still going: the saved answers queue a
    // follow-up run, which only starts once the first one releases.
    view.rerender(section(1));
    load.resolve(json(running));
    await waitFor(() => expect(server.gets).toBe(3));
    expect(server.posts).toHaveLength(0);

    poll.resolve(json(done));

    // The follow-up run tracks the saved answers' server run instead of
    // posting a second prompt, then settles at its done status.
    await waitFor(() => expect(server.gets).toBe(4));
    expect(server.posts).toHaveLength(0);
  });

  it("shows the stored generation error and retries it", async () => {
    const user = userEvent.setup();
    const server = stubPlanServer((index) =>
      index === 0
        ? respond(
            planResponse({
              generation: {
                status: "error",
                error: "The model is unavailable",
              },
            }),
          )
        : respond(done),
    );

    render(section(0));

    const error = await screen.findByTestId("plan-generation-error");
    expect(error.textContent).toContain(
      "The coach could not finish your plan: The model is unavailable",
    );
    // The stored plan owns the failure, so the generic error line stays hidden.
    expect(screen.queryByTestId("plan-error")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]?.mode).toBe("auto");
    await waitFor(() => expect(server.gets).toBe(2));
  });

  it("reports a failed calorie load without hiding the plan", async () => {
    const capture = spyOn(Sentry, "captureException");
    captureException = capture;
    stubPlanServer(undefined, () =>
      respond(
        { error: { code: "internal_error", message: "Diet is down" } },
        500,
      ),
    );

    render(section(0, { dietAdvice: true }));

    expect(await screen.findByTestId("coach-plan-view")).toBeDefined();
    await waitFor(() => expect(capture).toHaveBeenCalled());
    // The calorie panel is advisory, so the failed read shows no plan error.
    expect(screen.queryByTestId("plan-error")).toBeNull();
  });
});
