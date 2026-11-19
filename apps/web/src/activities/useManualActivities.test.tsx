import { afterEach, describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthState } from "../auth";
import { useManualActivities } from "./useManualActivities";

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

const activity = {
  id: 3,
  startDate: "2026-11-07",
  details: "Indoor climb for 45 minutes",
  coachReply: null,
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

function ManualActivitiesProbe({
  onChanged = () => Promise.resolve(),
}: {
  onChanged?: () => Promise<void>;
}) {
  const manual = useManualActivities(auth, "Europe/Oslo", onChanged);
  return (
    <div>
      <p data-testid="activities">
        {manual.activities.map((entry) => entry.details).join(",") || "none"}
      </p>
      <p data-testid="pending">
        {manual.pendingDelete === null
          ? "none"
          : String(manual.pendingDelete.id)}
      </p>
      <p data-testid="deleting">{String(manual.deleting)}</p>
      <p data-testid="error">{manual.error ?? "none"}</p>
      {manual.activities.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => manual.requestDelete(entry)}
        >
          Delete {entry.id}
        </button>
      ))}
      <button type="button" onClick={manual.cancelDelete}>
        Cancel
      </button>
      <button type="button" onClick={() => void manual.confirmDelete()}>
        Confirm
      </button>
    </div>
  );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useManualActivities", () => {
  it("loads the athlete's manual activities", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        json({ manualActivities: [activity] }),
      )) as unknown as typeof fetch;
    render(<ManualActivitiesProbe />);

    expect(await screen.findByText(activity.details)).toBeDefined();
  });

  it("asks for confirmation without deleting anything", async () => {
    const user = userEvent.setup();
    let deletions = 0;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      if ((init?.method ?? "GET") === "DELETE") {
        deletions += 1;
      }
      if (url.includes("/api/coaching/activities/manual")) {
        return Promise.resolve(json({ manualActivities: [activity] }));
      }
      return Promise.resolve(json({}));
    }) as unknown as typeof fetch;
    render(<ManualActivitiesProbe />);
    await screen.findByText(activity.details);

    await user.click(screen.getByRole("button", { name: "Delete 3" }));
    expect(screen.getByTestId("pending").textContent).toBe("3");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("pending").textContent).toBe("none");
    expect(deletions).toBe(0);
  });

  it("deletes only after the pending confirmation is confirmed", async () => {
    const user = userEvent.setup();
    let deleted = 0;
    let changed = 0;
    globalThis.fetch = ((
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if ((init?.method ?? "GET") === "DELETE") {
        deleted += 1;
        return Promise.resolve(json({ message: "Deleted", reply: null }));
      }
      return Promise.resolve(
        json({
          manualActivities: deleted === 0 ? [activity] : [],
        }),
      );
    }) as unknown as typeof fetch;
    render(
      <ManualActivitiesProbe
        onChanged={() => {
          changed += 1;
          return Promise.resolve();
        }}
      />,
    );
    await screen.findByText(activity.details);

    await user.click(screen.getByRole("button", { name: "Delete 3" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByTestId("pending").textContent).toBe("none"),
    );
    expect(deleted).toBe(1);
    expect(changed).toBe(1);
    expect(screen.getByTestId("activities").textContent).toBe("none");
  });

  it("keeps the pending confirmation and reports the error when deletion fails", async () => {
    const user = userEvent.setup();
    globalThis.fetch = ((
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if ((init?.method ?? "GET") === "DELETE") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "internal_error", message: "Delete failed" },
            }),
            {
              status: 500,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      return Promise.resolve(json({ manualActivities: [activity] }));
    }) as unknown as typeof fetch;
    render(<ManualActivitiesProbe />);
    await screen.findByText(activity.details);

    await user.click(screen.getByRole("button", { name: "Delete 3" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe("Delete failed"),
    );
    expect(screen.getByTestId("pending").textContent).toBe("3");
    expect(screen.getByTestId("deleting").textContent).toBe("false");
  });
});
