import { describe, expect, it } from "bun:test";
import type { LlmCallDetail, LlmCallSummary } from "@killingit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { LlmCallDetailView, LlmCallsView } from "./AdminLlmCallsSection";

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
