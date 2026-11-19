import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CoachPlanResponse } from "@killingit/shared";
import type { AuthState } from "../auth/auth0";
import {
  fetchCoachPlan,
  hasPendingWork,
  pollPlanGeneration,
} from "./planGeneration";

const noPending: CoachPlanResponse["pending"] = {
  initial: false,
  day: false,
  week: false,
  block: false,
  tomorrow: false,
  nextWeek: false,
  nextBlock: false,
  dietProgress: false,
};

function response(
  status: "idle" | "running" | "done" | "error",
  error: string | null = null,
): CoachPlanResponse {
  return {
    plan: null,
    generatedAt: null,
    generation: {
      status,
      step: status === "running" ? "Planning the week" : null,
      progress: status === "running" ? 40 : 100,
      error,
      runId: null,
      updatedAt: "2026-11-06T08:00:00.000Z",
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

function fakeAuth(): AuthState {
  return {
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getToken: () => Promise.resolve("test-token"),
  };
}

/** A clock and sleep pair that advances instantly. */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let clock = 0;
  return {
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  };
}

describe("fetchCoachPlan", () => {
  let originalFetch: typeof fetch;
  let requested: Array<{ url: string; init: RequestInit | undefined }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    requested = [];
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      requested.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(response("idle")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends today and the explicit tomorrow flag", async () => {
    const plan = await fetchCoachPlan(fakeAuth(), {
      today: "2026-11-16",
      includeTomorrow: true,
    });

    expect(plan.generation.status).toBe("idle");
    expect(requested[0]?.url).toBe(
      "/api/coaching/plan?today=2026-11-16&includeTomorrow=true",
    );
  });

  it("omits tomorrow when the caller only asks for today", async () => {
    await fetchCoachPlan(fakeAuth(), { today: "2026-11-16" });

    expect(requested[0]?.url).toBe("/api/coaching/plan?today=2026-11-16");
  });

  it("forwards the abort signal to the request", async () => {
    const controller = new AbortController();

    await fetchCoachPlan(
      fakeAuth(),
      { today: "2026-11-16" },
      controller.signal,
    );

    expect(requested[0]?.init?.signal).toBe(controller.signal);
  });
});

describe("hasPendingWork", () => {
  it("reports no work when every level is already planned", () => {
    expect(hasPendingWork(noPending)).toBe(false);
  });

  const levels = Object.keys(noPending) as Array<keyof typeof noPending>;
  for (const level of levels) {
    it(`reports work when ${level} is missing`, () => {
      expect(hasPendingWork({ ...noPending, [level]: true })).toBe(true);
    });
  }
});

describe("pollPlanGeneration", () => {
  it("keeps polling a running generation and reports every response", async () => {
    const responses = [response("running"), response("done")];
    const updates: CoachPlanResponse[] = [];
    const clock = fakeClock();

    const outcome = await pollPlanGeneration({
      today: "2026-11-06",
      includeTomorrow: false,
      request: null,
      fetchPlan: () => Promise.resolve(responses.shift() ?? response("done")),
      onUpdate: (update) => updates.push(update),
      ...clock,
    });

    expect(outcome.status).toBe("done");
    expect(updates.map((update) => update.generation.status)).toEqual([
      "running",
      "done",
    ]);
  });

  it("waits for the generate request before accepting a previous done status", async () => {
    let resolveRequest: () => void = () => undefined;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    let sleeps = 0;
    let clock = 0;

    const outcome = await pollPlanGeneration({
      today: "2026-11-06",
      includeTomorrow: false,
      request,
      fetchPlan: () => Promise.resolve(response("done")),
      onUpdate: () => undefined,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        sleeps += 1;
        if (sleeps === 2) {
          resolveRequest();
        }
        return Promise.resolve();
      },
    });

    expect(outcome.status).toBe("done");
    expect(sleeps).toBe(2);
  });

  it("returns the stored generation error without polling again", async () => {
    let polls = 0;
    const clock = fakeClock();

    const outcome = await pollPlanGeneration({
      today: "2026-11-06",
      includeTomorrow: false,
      request: null,
      fetchPlan: () => {
        polls += 1;
        return Promise.resolve(response("error", "The model refused the plan"));
      },
      onUpdate: () => undefined,
      ...clock,
    });

    expect(outcome).toEqual({
      status: "error",
      error: "The model refused the plan",
    });
    expect(polls).toBe(1);
  });

  it("describes a failed status request", async () => {
    const clock = fakeClock();

    const outcome = await pollPlanGeneration({
      today: "2026-11-06",
      includeTomorrow: false,
      request: null,
      fetchPlan: () => Promise.reject(new Error("Network down")),
      onUpdate: () => undefined,
      describeError: (error) =>
        error instanceof Error ? error.message : String(error),
      ...clock,
    });

    expect(outcome).toEqual({ status: "error", error: "Network down" });
  });

  it("times out when the generation never leaves running", async () => {
    const clock = fakeClock();

    const outcome = await pollPlanGeneration({
      today: "2026-11-06",
      includeTomorrow: false,
      request: null,
      fetchPlan: () => Promise.resolve(response("running")),
      onUpdate: () => undefined,
      intervalMs: 50,
      timeoutMs: 100,
      ...clock,
    });

    expect(outcome.status).toBe("timeout");
    if (outcome.status !== "timeout") {
      throw new Error("expected the generation to time out");
    }
    expect(outcome.error).toContain("taking longer than expected");
    expect(outcome.error).toContain("Refresh to check again");
  });
});
