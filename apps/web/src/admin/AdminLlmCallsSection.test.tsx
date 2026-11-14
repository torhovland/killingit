import { afterEach, describe, expect, it, mock } from "bun:test";
import type { LlmCallDetail, LlmCallSummary } from "@killingit/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";

const { SessionExpiredError } = await import("../auth/session");

await mock.module("../auth", () => ({
  SessionExpiredError,
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    sub: "admin",
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getToken: () => Promise.resolve("token"),
  }),
}));

const { AdminLlmCallsSection, LlmCallDetailView, LlmCallsView } =
  await import("./AdminLlmCallsSection");
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

function view(
  overrides: {
    calls?: LlmCallSummary[] | null;
    selected?: LlmCallDetail | null;
    loading?: boolean;
    error?: string | null;
  } = {},
) {
  return renderToStaticMarkup(
    <LlmCallsView
      calls={overrides.calls === undefined ? [summary] : overrides.calls}
      selectedId={12}
      selected={overrides.selected === undefined ? detail : overrides.selected}
      loading={overrides.loading ?? false}
      detailLoading={false}
      error={overrides.error ?? null}
      onSelect={() => undefined}
      onRefresh={() => undefined}
    />,
  );
}

describe("LlmCallsView", () => {
  it("lists calls with type, model, user, and datetime", () => {
    const html = view();

    expect(html).toContain("LLM prompts");
    expect(html).toContain("Season plan");
    expect(html).toContain("openrouter/model");
    expect(html).toContain("auth|admin");
    expect(html).toContain("1200 ms");
  });

  it("keeps the selected call readable instead of putting light text on accent", () => {
    const html = view();
    const marker = html.indexOf('aria-current="true"');
    const row = html.slice(
      html.lastIndexOf("<button", marker),
      html.indexOf("</button>", marker),
    );

    // Selection is a dark inset surface with an accent ring; the accent colour
    // itself is too light to carry the off-white and ice text reliably.
    expect(row).toContain("bg-inset");
    expect(row).toContain("ring-accent");
    expect(row).not.toContain("bg-accent");
    expect(row).toContain("text-muted-foreground");
  });

  it("marks a JSON repair as a retry and a failed plan", () => {
    const html = view({
      calls: [
        {
          ...summary,
          kind: "plan_update",
          repair: true,
          planFailed: true,
        },
      ],
      selected: null,
    });

    expect(html).toContain('data-testid="llm-call-retry"');
    expect(html).toContain("Retry");
    expect(html).toContain('data-testid="llm-call-plan-failed"');
    expect(html).toContain("Plan failed");
  });

  it("marks a fallback retry and its attempt number", () => {
    const html = view({
      calls: [{ ...summary, attempt: 2, ofAttempts: 3 }],
      selected: null,
    });

    expect(html).toContain('data-testid="llm-call-retry"');
    expect(html).toContain("Attempt 2/3");
  });

  it("gives a failed prompt its own status badge", () => {
    const html = view({
      calls: [{ ...summary, failed: true }],
      selected: null,
    });

    expect(html).toContain('data-testid="llm-call-status"');
    expect(html).toContain("Failed");
  });

  it("marks a call that has not settled as in flight", () => {
    const html = view({
      calls: [{ ...summary, pending: true }],
      selected: null,
    });

    expect(html).toContain('data-testid="llm-call-status"');
    expect(html).toContain("In flight");
  });

  it("shows the full prompt and response for the selected call", () => {
    const html = view();

    expect(html).toContain('data-testid="llm-call-detail"');
    expect(html).toContain("You are a coach.");
    expect(html).toContain("Plan my season.");
    expect(html).toContain("Here is the plan.");
    expect(html).toContain("Request metadata");
    expect(html).toContain("Prompt tokens");
  });

  it("puts the selected call beside the list instead of below it", () => {
    const html = view();

    // Two columns on wide screens: the list scrolls on its own and the full
    // prompt is visible next to it, without scrolling past the rest of the list.
    expect(html).toContain("lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]");
    const listIndex = html.indexOf('data-testid="llm-calls-list"');
    const detailPaneIndex = html.indexOf('data-testid="llm-call-detail-pane"');
    const detailIndex = html.indexOf('data-testid="llm-call-detail"');
    expect(listIndex).toBeGreaterThan(-1);
    expect(detailPaneIndex).toBeGreaterThan(listIndex);
    expect(detailIndex).toBeGreaterThan(detailPaneIndex);
    expect(html).not.toContain("Select a prompt to read it in full.");
  });

  it("prompts the admin to pick a call when none is selected", () => {
    const html = view({ selected: null });

    expect(html).toContain("Select a prompt to read it in full.");
    expect(html).not.toContain('data-testid="llm-call-detail"');
  });

  it("shows an empty state when nothing has been logged", () => {
    const html = view({ calls: [], selected: null });

    expect(html).toContain("No prompts have been sent yet.");
    expect(html).not.toContain('data-testid="llm-call-detail"');
  });

  it("shows request errors", () => {
    const html = view({ error: "Could not load prompts" });

    expect(html).toContain("Could not load prompts");
  });
});

describe("LlmCallDetailView", () => {
  it("shows the error for a failed call and no response", () => {
    const html = renderToStaticMarkup(
      <LlmCallDetailView
        call={{
          ...detail,
          response: null,
          failed: true,
          error: "Provider rate limit",
        }}
      />,
    );

    expect(html).toContain("Failed");
    expect(html).toContain("Provider rate limit");
    expect(html).not.toContain("Here is the plan.");
  });

  it("shows that a pending call is waiting for the provider", () => {
    const html = renderToStaticMarkup(
      <LlmCallDetailView
        call={{ ...detail, pending: true, response: null, durationMs: 0 }}
      />,
    );

    expect(html).toContain("In flight");
    expect(html).toContain("Waiting for the provider to answer.");
  });

  it("shows a repair turn that belonged to a failed plan", () => {
    const html = renderToStaticMarkup(
      <LlmCallDetailView
        call={{
          ...detail,
          kind: "plan_update",
          repair: true,
          planFailed: true,
          metadata: { repair: true, planError: "The season has a gap." },
        }}
      />,
    );

    expect(html).toContain("Retry");
    expect(html).toContain("Plan failed");
    expect(html).toContain("Plan failure: The season has a gap.");
  });
});

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

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

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AdminLlmCallsSection", () => {
  it("keeps the newest selected call when an older detail arrives last", async () => {
    const user = userEvent.setup();
    const first = pendingResponse();
    const second = pendingResponse();
    const signals = stubCalls(first, second);
    render(
      <AppStatusProvider>
        <AdminLlmCallsSection />
      </AppStatusProvider>,
    );

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
