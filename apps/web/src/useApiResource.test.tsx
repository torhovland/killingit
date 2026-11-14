import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ResponseSchema } from "./fetchAuthed";
import type { ApiRequests } from "./useApiResource";
import type { AuthState } from "./auth";

const { SessionExpiredError } = await import("./auth/session");

const SIGNED_OUT: AuthState = {
  isAuthenticated: false,
  isLoading: false,
  sub: null,
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve(undefined),
};

function signedIn(): AuthState {
  return {
    isAuthenticated: true,
    isLoading: false,
    sub: "user-1",
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getToken: () => Promise.resolve("token"),
  };
}

let auth: AuthState = signedIn();

await mock.module("./auth", () => ({
  SessionExpiredError,
  useAuth: () => auth,
}));

const { AppStatusProvider, useAppStatus } = await import("./AppStatus");
const { useAbortableRequest, useApiResource, useApiResources } =
  await import("./useApiResource");

interface Named {
  name: string;
}

const namedSchema: ResponseSchema<Named> = {
  safeParse(value) {
    if (
      typeof value === "object" &&
      value !== null &&
      "name" in value &&
      typeof value.name === "string"
    ) {
      return { success: true, data: { name: value.name } };
    }
    return { success: false, error: new Error("Expected a name") };
  },
};

interface FetchCall {
  url: string;
  signal: AbortSignal | undefined;
}

let calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

type Route = (signal: AbortSignal | undefined) => Promise<Response>;

/** Replaces fetch with one handler per URL fragment. */
function stubFetch(routes: Record<string, Route>): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, signal: init?.signal ?? undefined });
    const match = Object.entries(routes).find(([fragment]) =>
      url.includes(fragment),
    );
    if (match === undefined) {
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }
    return match[1](init?.signal ?? undefined);
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

function SingleProbe({
  path,
  statusSource,
}: {
  path: string | null;
  statusSource?: string;
}) {
  const state = useApiResource(
    path,
    namedSchema,
    "Loading the name",
    statusSource === undefined ? {} : { statusSource },
  );
  return (
    <div>
      <p data-testid="value">
        {state.loading ? "loading" : (state.data?.name ?? "empty")}
      </p>
      <p data-testid="error">{state.error ?? "none"}</p>
      <button type="button" onClick={state.reload}>
        Reload
      </button>
    </div>
  );
}

type MultiRequests = ApiRequests<{ first: Named; second: Named }>;

function MultiProbe({ requests }: { requests: MultiRequests | null }) {
  const state = useApiResources(requests);
  return (
    <div>
      <p data-testid="value">
        {state.data === null
          ? "none"
          : `${state.data.first.name}+${state.data.second.name}`}
      </p>
      <p data-testid="error">{state.error ?? "none"}</p>
    </div>
  );
}

function StatusProbe() {
  return <p data-testid="app-status">{useAppStatus().status}</p>;
}

let abortableSignals: AbortSignal[] = [];

function AbortableProbe() {
  const [load, abortAll] = useAbortableRequest((signal: AbortSignal) => {
    abortableSignals.push(signal);
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  });
  return (
    <>
      <button type="button" onClick={() => void load().catch(() => undefined)}>
        Start
      </button>
      <button type="button" onClick={abortAll}>
        Abort
      </button>
    </>
  );
}

beforeEach(() => {
  auth = signedIn();
  abortableSignals = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
});

describe("useApiResource", () => {
  it("loads the resource and clears the header spinner source", async () => {
    const pending = deferred();
    stubFetch({ "/api/name": () => pending.promise });

    render(
      <AppStatusProvider>
        <SingleProbe path="/api/name" statusSource="name-page" />
        <StatusProbe />
      </AppStatusProvider>,
    );

    expect(screen.getByTestId("value").textContent).toBe("loading");
    expect(screen.getByTestId("app-status").textContent).toBe("loading");

    pending.resolve(json({ name: "Loaded" }));

    expect(await screen.findByText("Loaded")).toBeDefined();
    expect(screen.getByTestId("error").textContent).toBe("none");
    await waitFor(() =>
      expect(screen.getByTestId("app-status").textContent).toBe("idle"),
    );
  });

  it("does not request anything without a path", async () => {
    stubFetch({});

    render(
      <AppStatusProvider>
        <SingleProbe path={null} />
      </AppStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("value").textContent).toBe("empty"),
    );
    expect(calls).toHaveLength(0);
  });

  it("does not request anything for a signed-out session", async () => {
    auth = SIGNED_OUT;
    stubFetch({});

    render(
      <AppStatusProvider>
        <SingleProbe path="/api/name" />
      </AppStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("value").textContent).toBe("empty"),
    );
    expect(calls).toHaveLength(0);
  });

  it("exposes a failed request as an error message", async () => {
    stubFetch({
      "/api/name": () =>
        Promise.resolve(
          json(
            { error: { code: "internal_error", message: "The API is down" } },
            500,
          ),
        ),
    });

    render(
      <AppStatusProvider>
        <SingleProbe path="/api/name" statusSource="name-page" />
        <StatusProbe />
      </AppStatusProvider>,
    );

    expect(await screen.findByText("The API is down")).toBeDefined();
    expect(screen.getByTestId("value").textContent).toBe("empty");
    expect(screen.getByTestId("app-status").textContent).toBe("idle");
  });

  it("refetches when reload is called", async () => {
    const user = userEvent.setup();
    let loads = 0;
    stubFetch({
      "/api/name": () => {
        loads += 1;
        return Promise.resolve(json({ name: `Load ${loads}` }));
      },
    });

    render(
      <AppStatusProvider>
        <SingleProbe path="/api/name" />
      </AppStatusProvider>,
    );
    expect(await screen.findByText("Load 1")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Reload" }));

    expect(await screen.findByText("Load 2")).toBeDefined();
    expect(loads).toBe(2);
  });

  it("aborts a superseded path and drops its late response", async () => {
    const slow = deferred();
    stubFetch({
      "/api/slow": () => slow.promise,
      "/api/fast": () => Promise.resolve(json({ name: "Fast" })),
    });

    const { rerender } = render(
      <AppStatusProvider>
        <SingleProbe path="/api/slow" />
      </AppStatusProvider>,
    );
    await waitFor(() => expect(calls).toHaveLength(1));

    rerender(
      <AppStatusProvider>
        <SingleProbe path="/api/fast" />
      </AppStatusProvider>,
    );

    expect(await screen.findByText("Fast")).toBeDefined();
    expect(calls[0]?.signal?.aborted).toBe(true);

    await act(async () => {
      slow.resolve(json({ name: "Slow" }));
      await Promise.resolve();
    });

    expect(calls).toHaveLength(2);
    expect(screen.getByTestId("value").textContent).toBe("Fast");
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("aborts the request on unmount without surfacing an error", async () => {
    stubFetch({ "/api/name": () => new Promise<Response>(() => undefined) });

    const { unmount } = render(
      <AppStatusProvider>
        <SingleProbe path="/api/name" statusSource="name-page" />
      </AppStatusProvider>,
    );
    await waitFor(() => expect(calls).toHaveLength(1));

    unmount();

    expect(calls[0]?.signal?.aborted).toBe(true);
  });
});

describe("useApiResources", () => {
  const requests = {
    first: { path: "/api/first", schema: namedSchema, action: "Loading first" },
    second: {
      path: "/api/second",
      schema: namedSchema,
      action: "Loading second",
    },
  };

  it("keeps every loaded value together", async () => {
    stubFetch({
      "/api/first": () => Promise.resolve(json({ name: "One" })),
      "/api/second": () => Promise.resolve(json({ name: "Two" })),
    });

    render(
      <AppStatusProvider>
        <MultiProbe requests={requests} />
      </AppStatusProvider>,
    );

    expect(await screen.findByText("One+Two")).toBeDefined();
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("leaves the resource unset when one request fails", async () => {
    stubFetch({
      "/api/first": () => Promise.resolve(json({ name: "One" })),
      "/api/second": () =>
        Promise.resolve(
          json(
            { error: { code: "internal_error", message: "No second value" } },
            500,
          ),
        ),
    });

    render(
      <AppStatusProvider>
        <MultiProbe requests={requests} />
      </AppStatusProvider>,
    );

    expect(await screen.findByText("No second value")).toBeDefined();
    expect(screen.getByTestId("value").textContent).toBe("none");
  });

  it("does not load until there are requests", async () => {
    stubFetch({});

    render(
      <AppStatusProvider>
        <MultiProbe requests={null} />
      </AppStatusProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("value").textContent).toBe("none"),
    );
    expect(calls).toHaveLength(0);
  });
});

describe("useAbortableRequest", () => {
  it("aborts every in-flight request when abortAll runs", async () => {
    const user = userEvent.setup();
    render(<AbortableProbe />);

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(abortableSignals[0]?.aborted).toBe(false);

    await user.click(screen.getByRole("button", { name: "Abort" }));

    expect(abortableSignals[0]?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
  });

  it("aborts an in-flight request when the owner unmounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AbortableProbe />);

    await user.click(screen.getByRole("button", { name: "Start" }));
    unmount();

    expect(abortableSignals[0]?.aborted).toBe(true);
  });
});
