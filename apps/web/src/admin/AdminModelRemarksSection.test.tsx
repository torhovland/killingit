import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import type { LlmModelRemark } from "@killingit/shared";
import type { AuthState } from "../auth";
import { render, screen } from "@testing-library/react";
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

const { AdminModelRemarksSection } = await import("./AdminModelRemarksSection");
const { AppStatusProvider } = await import("../AppStatus");

const remark: LlmModelRemark = {
  callId: 12,
  createdAt: "2026-10-28T09:00:00.000Z",
  userId: 1,
  userLabel: "auth|admin",
  kind: "season_plan",
  model: "openrouter/model",
  remarks: "The block boundary looked inconsistent.",
};

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

/** Serves the given remarks for the admin remarks route. */
function stubApi(remarks: LlmModelRemark[]): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/admin/llm-calls/remarks?limit")) {
      return Promise.resolve(json({ remarks }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

function renderSection(timeZone = "Europe/Oslo") {
  return render(
    <AppStatusProvider>
      <TimeZoneProvider timeZone={timeZone}>
        <AdminModelRemarksSection />
      </TimeZoneProvider>
    </AppStatusProvider>,
  );
}

describe("AdminModelRemarksSection", () => {
  it("lists the model, user, prompt and remark of each entry", async () => {
    stubApi([remark]);
    renderSection();

    const item = await screen.findByTestId("model-remark");
    expect(item.textContent).toContain("Season plan");
    expect(item.textContent).toContain(remark.model);
    expect(item.textContent).toContain(remark.userLabel);
    expect(item.textContent).toContain("Prompt #12");
    expect(item.textContent).toContain(remark.remarks);
  });

  it("formats the remark time in the account's zone", async () => {
    const zone = "Pacific/Kiritimati";
    stubApi([remark]);
    renderSection(zone);

    const item = await screen.findByTestId("model-remark");
    expect(item.textContent).toContain(formatDateTime(remark.createdAt, zone));
    expect(item.textContent).not.toContain(
      formatDateTime(remark.createdAt, "UTC"),
    );
  });

  it("says when no remarks were reported", async () => {
    stubApi([]);
    renderSection();

    expect(
      await screen.findByText("No model remarks were reported recently."),
    ).toBeTruthy();
  });
});
