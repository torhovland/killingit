import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthState } from "./auth";

const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: "user-1",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

const saved: string[] = [];

await mock.module("./download", () => ({
  saveBlob: (_blob: Blob, filename: string) => {
    saved.push(filename);
  },
}));

const { usePlanWorkoutDownload } = await import("./usePlanWorkoutDownload");

function DownloadProbe() {
  const download = usePlanWorkoutDownload(auth);
  return (
    <div>
      <p data-testid="downloading">{download.downloadingDate ?? "none"}</p>
      <p data-testid="error">{download.error ?? "none"}</p>
      <button
        type="button"
        onClick={() => download.downloadWorkout("2026-11-15")}
      >
        Download
      </button>
    </div>
  );
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

const originalFetch = globalThis.fetch;

afterAll(() => {
  mock.restore();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  saved.length = 0;
});

describe("usePlanWorkoutDownload", () => {
  it("saves the downloaded file under its server filename", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("zwo", {
          headers: {
            "content-disposition":
              'attachment; filename="2026-11-15-sweet-spot.zwo"',
          },
        }),
      )) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<DownloadProbe />);

    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(saved).toEqual(["2026-11-15-sweet-spot.zwo"]));
    expect(screen.getByTestId("downloading").textContent).toBe("none");
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("falls back to the date when the server sends no filename", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("zwo"))) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<DownloadProbe />);

    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(saved).toEqual(["2026-11-15-workout.zwo"]));
  });

  it("marks the in-flight date until the download settles", async () => {
    const response = deferred();
    globalThis.fetch = (() => response.promise) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<DownloadProbe />);

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(screen.getByTestId("downloading").textContent).toBe("2026-11-15");
    response.resolve(new Response("zwo", { status: 500 }));
    await waitFor(() =>
      expect(screen.getByTestId("downloading").textContent).toBe("none"),
    );
  });

  it("reports a failed download and stops marking it in flight", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("Network down"))) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<DownloadProbe />);

    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe("Network down"),
    );
    expect(screen.getByTestId("downloading").textContent).toBe("none");
    expect(saved).toEqual([]);
  });
});
