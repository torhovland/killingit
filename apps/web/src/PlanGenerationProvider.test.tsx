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
import { act, render, screen, waitFor } from "@testing-library/react";
import type { CoachPlanResponse } from "@killingit/shared";
import type { AuthState } from "./auth";
import { plan } from "./testFixtures/plan";

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

const { AppStatusProvider } = await import("./AppStatus");
const { PlanGenerationProvider, usePlanGeneration } =
  await import("./PlanGenerationProvider");
const { TimeZoneProvider } = await import("./TimeZoneContext");

/** The live context value, refreshed on every provider render. */
let generation: ReturnType<typeof usePlanGeneration>;

function Probe() {
  generation = usePlanGeneration();
  return <p data-testid="running">{generation.running ? "running" : "idle"}</p>;
}

function provider() {
  return (
    <AppStatusProvider>
      <TimeZoneProvider timeZone="UTC">
        <PlanGenerationProvider>
          <Probe />
        </PlanGenerationProvider>
      </TimeZoneProvider>
    </AppStatusProvider>
  );
}

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
  generation: Partial<CoachPlanResponse["generation"]> = {},
): CoachPlanResponse {
  return {
    plan,
    generatedAt: null,
    generation: {
      status: "idle",
      step: null,
      progress: 0,
      error: null,
      runId: null,
      updatedAt: "2026-11-15T08:00:00.000Z",
      ...generation,
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

const running = planResponse({
  status: "running",
  step: "Building your week",
  progress: 40,
  runId: "run-1",
  updatedAt: "2026-11-15T08:00:01.000Z",
});
const done = planResponse({
  status: "done",
  step: "Done",
  progress: 100,
  runId: "run-1",
  updatedAt: "2026-11-15T08:00:02.000Z",
});

interface Server {
  gets: number;
  posts: Array<Record<string, unknown>>;
  reply: (getIndex: number) => Promise<Response>;
}

/** Serves the generate POST and the plan status GETs the provider makes. */
function stubServer(
  reply: (getIndex: number) => Promise<Response> = () => respond(done),
): Server {
  const server: Server = { gets: 0, posts: [], reply };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/coaching/plan/generate")) {
      if (typeof init?.body !== "string") {
        return Promise.reject(new Error("Expected a JSON request body"));
      }
      server.posts.push(JSON.parse(init.body) as Record<string, unknown>);
      return Promise.resolve(json({}));
    }
    if (url.includes("/api/coaching/plan?today=")) {
      const index = server.gets;
      server.gets += 1;
      return server.reply(index);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as typeof fetch;
  return server;
}

beforeEach(() => {
  setSystemTime(new Date("2026-11-15T12:00:00Z"));
  // The production poll interval is 1.5 s. Shorten only that sleep so the real
  // polling loop stays fast; Testing Library's own timers keep their timing.
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
  auth.sub = "user-1";
  setSystemTime();
});

describe("PlanGenerationProvider", () => {
  it("polls a started run to its terminal state and keeps the newest plan", async () => {
    const server = stubServer((index) =>
      index === 0 ? respond(running) : respond(done),
    );
    render(provider());

    await act(async () => {
      await generation.start("auto");
    });

    expect(server.posts).toEqual([
      {
        today: "2026-11-15",
        timezone: "UTC",
        mode: "auto",
        includeTomorrow: false,
      },
    ]);
    expect(server.gets).toBe(2);
    expect(generation.running).toBe(false);
    expect(generation.progress).toBeNull();
    expect(generation.revision).toBe(1);
    expect(generation.error).toBeNull();
    expect(generation.latest?.generation.status).toBe("done");
    expect(screen.getByTestId("running").textContent).toBe("idle");
  });

  it("does not commit a run superseded by an account change", async () => {
    let release: (response: Response) => void = () => undefined;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const server = stubServer((index) =>
      index === 0 ? respond(running) : held,
    );
    const view = render(provider());

    let started: Promise<unknown> = Promise.resolve();
    act(() => {
      started = generation.start("auto");
    });
    await waitFor(() => expect(server.gets).toBe(2));

    auth.sub = "user-2";
    view.rerender(provider());

    await act(async () => {
      release(json(done));
      await started;
    });

    expect(generation.latest).toBeNull();
    expect(generation.revision).toBe(0);
    expect(generation.error).toBeNull();
    expect(generation.running).toBe(false);
    expect(screen.getByTestId("running").textContent).toBe("idle");
  });

  it("tracks an already-running server run without starting a new one", async () => {
    const server = stubServer((index) =>
      index === 0 ? respond(running) : respond(done),
    );
    render(provider());

    act(() => {
      generation.track();
    });

    await waitFor(() => expect(generation.revision).toBe(1));
    expect(server.gets).toBe(2);
    expect(server.posts).toHaveLength(0);
    expect(generation.error).toBeNull();
    expect(generation.latest?.generation.status).toBe("done");
  });

  it("surfaces a generation that ends in error", async () => {
    const failed = planResponse({
      status: "error",
      error: "The model is unavailable",
      runId: "run-1",
      updatedAt: "2026-11-15T08:00:02.000Z",
    });
    stubServer(() => respond(failed));
    render(provider());

    await act(async () => {
      await generation.start("auto");
    });

    expect(generation.error).toBe("The model is unavailable");
    expect(generation.running).toBe(false);
    expect(generation.revision).toBe(1);
    expect(generation.latest?.generation.status).toBe("error");
  });

  it("surfaces a failed status request", async () => {
    stubServer(() =>
      respond(
        {
          error: {
            code: "internal_error",
            message: "The plan could not be loaded",
          },
        },
        500,
      ),
    );
    render(provider());

    await act(async () => {
      await generation.start("auto");
    });

    expect(generation.error).toBe("The plan could not be loaded");
    expect(generation.running).toBe(false);
    expect(generation.revision).toBe(1);
  });
});
