import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import type { LlmCallDetail, LlmCallSummary } from "@killingit/shared";
import type { AuthState } from "../auth";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatDateTime } from "../timeZone";
import { TimeZoneProvider } from "../TimeZoneContext";

const { SessionExpiredError } = await import("../auth/session");

/** Stable identity, as the real `useAuth` contract promises. */
const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "admin",
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

const { AdminLlmCallsSection } = await import("./AdminLlmCallsSection");
const { AppStatusProvider } = await import("../AppStatus");

const summary: LlmCallSummary = {
  id: 12,
  createdAt: "2026-10-28T09:00:00.000Z",
  userId: 1,
  userLabel: "auth|admin",
  kind: "season_plan",
  provider: "openrouter",
  model: "openrouter/model",
  durationMs: 1200,
  failed: false,
  pending: false,
  repair: false,
  attempt: null,
  ofAttempts: null,
  planFailed: false,
};

const detail: LlmCallDetail = {
  ...summary,
  messages: [
    { role: "system", content: "You are a coach." },
    { role: "user", content: "Plan my season." },
  ],
  response: "Here is the plan.",
  error: null,
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  metadata: { attempt: 1, temperature: 0.4 },
};

const otherSummary: LlmCallSummary = {
  ...summary,
  id: 13,
  kind: "plan_update",
  model: "openrouter/other-model",
};

function detailFor(call: LlmCallSummary, response: string): LlmCallDetail {
  return {
    ...detail,
    ...call,
    response,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Serves one prompt list and the detail for any call it names. */
function stubApi(
  calls: LlmCallSummary[],
  details: Record<number, LlmCallDetail> = {},
): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/admin/llm-calls?limit")) {
      return Promise.resolve(json({ calls }));
    }
    const match = /\/api\/admin\/llm-calls\/(\d+)$/.exec(url);
    const call =
      match?.[1] === undefined ? undefined : details[Number(match[1])];
    return call === undefined
      ? Promise.reject(new Error(`Unexpected fetch: ${url}`))
      : Promise.resolve(json(call));
  }) as typeof fetch;
}

function renderSection(timeZone = "Europe/Oslo") {
  return render(
    <AppStatusProvider>
      <TimeZoneProvider timeZone={timeZone}>
        <AdminLlmCallsSection />
      </TimeZoneProvider>
    </AppStatusProvider>,
  );
}

async function selectCall(name: RegExp) {
  const user = userEvent.setup();
  const row = await screen.findByRole("button", { name });
  await user.click(row);
  return row;
}

describe("AdminLlmCallsSection", () => {
  it("lists calls with type, model, user, and duration", async () => {
    stubApi([summary]);
    renderSection();

    const row = await screen.findByRole("button", {
      name: /openrouter\/model/,
    });

    expect(screen.getByText("LLM prompts")).toBeDefined();
    expect(row.textContent).toContain("Season plan");
    expect(row.textContent).toContain("openrouter/model");
    expect(row.textContent).toContain("auth|admin");
    expect(row.textContent).toContain("1200 ms");
  });

  it("formats both the list and the detail time in the account's zone", async () => {
    const zone = "Pacific/Kiritimati";
    stubApi([summary], { 12: detail });
    renderSection(zone);

    const row = await screen.findByRole("button", {
      name: /openrouter\/model/,
    });
    expect(row.textContent).toContain(formatDateTime(summary.createdAt, zone));
    expect(row.textContent).not.toContain(
      formatDateTime(summary.createdAt, "UTC"),
    );

    await selectCall(/openrouter\/model/);
    const card = await screen.findByTestId("llm-call-detail");
    expect(card.textContent).toContain(formatDateTime(summary.createdAt, zone));
    expect(card.textContent).not.toContain(
      formatDateTime(summary.createdAt, "UTC"),
    );
  });

  it("keeps the selected call readable instead of putting light text on accent", async () => {
    stubApi([summary], { 12: detail });
    const { container } = renderSection();

    const row = await selectCall(/openrouter\/model/);

    // Selection is a dark inset surface with an accent ring; the accent colour
    // itself is too light to carry the off-white and ice text reliably.
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.className).toContain("bg-inset");
    expect(row.className).toContain("ring-accent");
    expect(container.innerHTML).not.toContain("bg-accent");
    expect(row.innerHTML).toContain("text-muted-foreground");
  });

  it("marks a JSON repair as a retry and a failed plan", async () => {
    stubApi([
      {
        ...summary,
        kind: "plan_update",
        repair: true,
        planFailed: true,
      },
    ]);
    renderSection();

    const row = await screen.findByRole("button", { name: /Plan update/ });

    expect(within(row).getByTestId("llm-call-retry").textContent).toBe("Retry");
    expect(within(row).getByTestId("llm-call-plan-failed").textContent).toBe(
      "Plan failed",
    );
  });

  it("marks a fallback retry and its attempt number", async () => {
    stubApi([{ ...summary, attempt: 2, ofAttempts: 3 }]);
    renderSection();

    const row = await screen.findByRole("button", {
      name: /openrouter\/model/,
    });

    expect(within(row).getByTestId("llm-call-retry")).toBeDefined();
    expect(row.textContent).toContain("Attempt 2/3");
  });

  it("gives a failed prompt its own status badge", async () => {
    stubApi([{ ...summary, failed: true }]);
    renderSection();

    const row = await screen.findByRole("button", {
      name: /openrouter\/model/,
    });

    expect(within(row).getByTestId("llm-call-status").textContent).toBe(
      "Failed",
    );
  });

  it("marks a call that has not settled as in flight", async () => {
    stubApi([{ ...summary, pending: true }]);
    renderSection();

    const row = await screen.findByRole("button", {
      name: /openrouter\/model/,
    });

    expect(within(row).getByTestId("llm-call-status").textContent).toBe(
      "In flight",
    );
  });

  it("shows the full prompt and response for the selected call", async () => {
    stubApi([summary], { 12: detail });
    renderSection();

    await selectCall(/openrouter\/model/);
    const card = await screen.findByTestId("llm-call-detail");

    expect(card.textContent).toContain("You are a coach.");
    expect(card.textContent).toContain("Plan my season.");
    expect(card.textContent).toContain("Here is the plan.");
    expect(card.textContent).toContain("Request metadata");
    expect(card.textContent).toContain("Prompt tokens");
  });

  it("puts the selected call beside the list instead of below it", async () => {
    stubApi([summary], { 12: detail });
    const { container } = renderSection();

    await selectCall(/openrouter\/model/);
    await screen.findByTestId("llm-call-detail");

    // Two columns on wide screens: the list scrolls on its own and the full
    // prompt is visible next to it, without scrolling past the rest of the list.
    const html = container.innerHTML;
    expect(html).toContain("lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]");
    const listIndex = html.indexOf('data-testid="llm-calls-list"');
    const detailPaneIndex = html.indexOf('data-testid="llm-call-detail-pane"');
    const detailIndex = html.indexOf('data-testid="llm-call-detail"');
    expect(listIndex).toBeGreaterThan(-1);
    expect(detailPaneIndex).toBeGreaterThan(listIndex);
    expect(detailIndex).toBeGreaterThan(detailPaneIndex);
    expect(html).not.toContain("Select a prompt to read it in full.");
  });

  it("prompts the admin to pick a call when none is selected", async () => {
    stubApi([summary]);
    renderSection();

    await screen.findByRole("button", { name: /openrouter\/model/ });

    expect(
      screen.getByText("Select a prompt to read it in full."),
    ).toBeDefined();
    expect(screen.queryByTestId("llm-call-detail")).toBeNull();
  });

  it("shows an empty state when nothing has been logged", async () => {
    stubApi([]);
    renderSection();

    expect(
      await screen.findByText("No prompts have been sent yet."),
    ).toBeDefined();
    expect(screen.queryByTestId("llm-call-detail")).toBeNull();
  });

  it("shows request errors", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("Could not load prompts", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
      )) as unknown as typeof fetch;
    renderSection();

    const error = await screen.findByTestId("admin-llm-calls-error");
    expect(error.textContent).toContain("Could not load prompts");
  });

  it("shows the error for a failed call and no response", async () => {
    const failed = {
      ...detail,
      response: null,
      failed: true,
      error: "Provider rate limit",
    };
    stubApi([{ ...summary, failed: true }], { 12: failed });
    renderSection();

    await selectCall(/openrouter\/model/);
    const card = await screen.findByTestId("llm-call-detail");

    expect(card.textContent).toContain("Failed");
    expect(card.textContent).toContain("Provider rate limit");
    expect(card.textContent).not.toContain("Here is the plan.");
  });

  it("shows that a pending call is waiting for the provider", async () => {
    const pending = { ...detail, pending: true, response: null, durationMs: 0 };
    stubApi([{ ...summary, pending: true }], { 12: pending });
    renderSection();

    await selectCall(/openrouter\/model/);
    const card = await screen.findByTestId("llm-call-detail");

    expect(card.textContent).toContain("In flight");
    expect(card.textContent).toContain("Waiting for the provider to answer.");
  });

  it("shows a repair turn that belonged to a failed plan", async () => {
    const repair = {
      ...detail,
      kind: "plan_update" as const,
      repair: true,
      planFailed: true,
      metadata: { repair: true, planError: "The season has a gap." },
    };
    stubApi(
      [{ ...summary, kind: "plan_update", repair: true, planFailed: true }],
      {
        12: repair,
      },
    );
    renderSection();

    await selectCall(/Plan update/);
    const card = await screen.findByTestId("llm-call-detail");

    expect(card.textContent).toContain("Retry");
    expect(card.textContent).toContain("Plan failed");
    expect(card.textContent).toContain("Plan failure: The season has a gap.");
  });

  it("keeps the newest selected call when an older detail arrives last", async () => {
    const user = userEvent.setup();
    const first = pendingResponse();
    const second = pendingResponse();
    const signals = stubCalls(first, second);
    renderSection();

    await user.click(
      await screen.findByRole("button", { name: /Season plan/ }),
    );
    await waitFor(() => expect(signals).toHaveLength(1));

    await user.click(
      await screen.findByRole("button", { name: /Plan update/ }),
    );
    await waitFor(() => expect(signals).toHaveLength(2));

    // The newest request answers first, then the superseded one arrives late.
    second.resolve(json(detailFor(otherSummary, "The newest call")));
    expect(await screen.findByText("The newest call")).toBeDefined();

    first.resolve(json(detailFor(summary, "The stale call")));

    // Let the late response run its full settle path before asserting.
    await waitFor(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByText("The stale call")).toBeNull();
        expect(screen.getByText("The newest call")).toBeDefined();
      },
      { timeout: 500, interval: 10 },
    );
    // The superseded request was aborted too, rather than merely ignored.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

interface PendingResponse {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}

function pendingResponse(): PendingResponse {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Serves the list immediately and lets each detail answer in any order. */
function stubCalls(
  first: PendingResponse,
  second: PendingResponse,
): Array<AbortSignal | undefined> {
  const detailSignals: Array<AbortSignal | undefined> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/admin/llm-calls?limit")) {
      return Promise.resolve(json({ calls: [summary, otherSummary] }));
    }
    const match = /\/api\/admin\/llm-calls\/(\d+)$/.exec(url);
    if (match?.[1] === "12") {
      detailSignals.push(init?.signal ?? undefined);
      return first.promise;
    }
    if (match?.[1] === "13") {
      detailSignals.push(init?.signal ?? undefined);
      return second.promise;
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as typeof fetch;
  return detailSignals;
}
