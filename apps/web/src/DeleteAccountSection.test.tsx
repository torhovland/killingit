import { afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthState } from "./auth";

const { SessionExpiredError } = await import("./auth/session");

let loggedOut = 0;

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => {
    loggedOut += 1;
    return Promise.resolve();
  },
  getToken: () => Promise.resolve("token"),
};

await mock.module("./auth", () => ({
  SessionExpiredError,
  useAuth: () => auth,
}));

const { DeleteAccountSection } = await import("./DeleteAccountSection");

const originalFetch = globalThis.fetch;

function stubFetch(response: Response): void {
  globalThis.fetch = (() =>
    Promise.resolve(response)) as unknown as typeof fetch;
}

function stubPendingFetch(): (response: Response) => void {
  let resolve: (response: Response) => void = () => undefined;
  globalThis.fetch = (() =>
    new Promise<Response>((settle) => {
      resolve = settle;
    })) as unknown as typeof fetch;
  return (response) => resolve(response);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  loggedOut = 0;
});

describe("DeleteAccountSection", () => {
  it("warns what will be deleted before confirming", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    expect(screen.queryByRole("dialog")).toBeNull();
    const trigger = screen.getByTestId("delete-account-button");
    await user.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("delete-account-title");
    expect(dialog.getAttribute("aria-describedby")).toBe(
      "delete-account-warning",
    );
    expect(screen.getByText("Delete your account?")).toBeDefined();
    expect(screen.getByText(/permanently deletes your account/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getByTestId("delete-account-confirm")).toBeDefined();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("closes on Cancel and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    const trigger = screen.getByTestId("delete-account-button");
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await user.click(screen.getByTestId("delete-account-button"));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes the account and signs out after confirmation", async () => {
    const user = userEvent.setup();
    stubFetch(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<DeleteAccountSection />);
    await user.click(screen.getByTestId("delete-account-button"));

    await user.click(screen.getByTestId("delete-account-confirm"));

    await waitFor(() => expect(loggedOut).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("blocks Escape and both actions while deletion is running", async () => {
    const user = userEvent.setup();
    const finish = stubPendingFetch();
    render(<DeleteAccountSection />);
    await user.click(screen.getByTestId("delete-account-button"));

    await user.click(screen.getByTestId("delete-account-confirm"));

    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByTestId<HTMLButtonElement>("delete-account-confirm").disabled,
    ).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeDefined();

    finish(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => expect(loggedOut).toBe(1));
  });

  it("shows a failed deletion inside the dialog and stays open", async () => {
    const user = userEvent.setup();
    stubFetch(
      new Response(
        JSON.stringify({
          error: { code: "internal_error", message: "The API is unavailable" },
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    render(<DeleteAccountSection />);
    await user.click(screen.getByTestId("delete-account-button"));

    await user.click(screen.getByTestId("delete-account-confirm"));

    expect(
      await screen.findByText("Error: The API is unavailable"),
    ).toBeDefined();
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(loggedOut).toBe(0);
    expect(
      screen.getByTestId<HTMLButtonElement>("delete-account-confirm").disabled,
    ).toBe(false);
  });
});
