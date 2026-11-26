import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import type { DietSummaryResponse, FoodEntry } from "@killingit/shared";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { SessionExpiredError } = await import("../auth/session");

/** One stable session, as `useAuth` returns in the app, so effects keep a key. */
const session = {
  isAuthenticated: true,
  isLoading: false,
  sub: "athlete",
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

await mock.module("../auth", () => ({
  SessionExpiredError,
  useAuth: () => session,
}));

afterAll(() => {
  mock.restore();
});

/**
 * The real exports, captured before the module is replaced so the mock keeps
 * every one another test imports. A nullable override lets a test roll the
 * athlete's day over without waiting for a real midnight; the mock is
 * process-wide, so an unset override falls straight through to the real clock.
 */
const realUseToday = { ...(await import("../useToday")) };
let todayOverride: string | null = null;

await mock.module("../useToday", () => ({
  ...realUseToday,
  getToday: (timeZone?: string) => {
    const real = realUseToday.getToday(timeZone);
    return todayOverride === null ? real : { ...real, today: todayOverride };
  },
}));

const { DietPage } = await import("./DietPage");
const { AppStatusProvider } = await import("../AppStatus");
const { CurrentUserProvider } = await import("../CurrentUserProvider");
const { TimeZoneProvider } = await import("../TimeZoneContext");

const ATHLETE = {
  sub: "athlete",
  role: "member",
  timezone: "Europe/Oslo",
  location: null,
  dietAdvice: true,
};

const DAY_ONE = "2026-03-02";
const DAY_TWO = "2026-03-03";

function summary(date: string, neededKcal: number): DietSummaryResponse {
  return {
    goal: "Hold my weight",
    goalProvided: true,
    assessment: null,
    days: [
      {
        date,
        neededCaloriesKcal: neededKcal,
        calorieBreakdown: null,
        consumedCaloriesKcal: 900,
        balanceKcal: 900 - neededKcal,
        entries: [meal(date)],
      },
    ],
  };
}

function meal(date: string): FoodEntry {
  return {
    id: 7,
    eatenAt: `${date}T12:00:00.000Z`,
    eatenDate: date,
    description: "Porridge",
    hasPhoto: false,
    analysis: {
      meal: "A bowl of porridge",
      carbsGrams: 60,
      proteinGrams: 15,
      fatGrams: 8,
      caloriesKcal: 900,
      dietFit: "Fits the goal.",
    },
    analysisError: null,
    updatedAt: `${date}T12:00:00.000Z`,
  };
}

interface FetchCall {
  url: string;
  signal: AbortSignal | undefined;
}

let calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

type Route = (signal: AbortSignal | undefined) => Promise<Response>;

/**
 * Replaces fetch with one handler per URL fragment. Fragments are matched in
 * order, so a more specific one must be listed before a shorter one it starts
 * with.
 */
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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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

/** Lets every promise chained onto an already-resolved response settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function page() {
  return (
    <AppStatusProvider>
      <CurrentUserProvider>
        <TimeZoneProvider timeZone="Europe/Oslo">
          <DietPage />
        </TimeZoneProvider>
      </CurrentUserProvider>
    </AppStatusProvider>
  );
}

/** The diet summary requests, ignoring the account load beside them. */
function summaryCalls(): FetchCall[] {
  return calls.filter((call) => call.url.includes("/api/diet/summary"));
}

/**
 * The logged days repeat the needed calories shown by the "Today" panel, so
 * assert inside the day list to keep the query to one element.
 */
function dietDays(): HTMLElement {
  return screen.getByTestId("diet-days");
}

async function findNeeded(kcal: string): Promise<void> {
  const days = await screen.findByTestId("diet-days");
  expect(await within(days).findByText(kcal)).toBeDefined();
}

beforeEach(() => {
  todayOverride = DAY_ONE;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
  todayOverride = null;
});

describe("DietPage", () => {
  it("shows the summary reloaded after a meal edit", async () => {
    const user = userEvent.setup();
    let summaryLoads = 0;
    stubFetch({
      "/api/me": () => Promise.resolve(json(ATHLETE)),
      "/api/measurements": () => Promise.resolve(json({ metrics: [] })),
      "/api/diet/summary": () => {
        summaryLoads += 1;
        return Promise.resolve(
          json(summary(DAY_ONE, summaryLoads === 1 ? 2400 : 2100)),
        );
      },
      "/api/diet/entries/7": () => Promise.resolve(json(meal(DAY_ONE))),
    });

    render(page());
    await findNeeded("2400 kcal");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      screen.getByRole("button", { name: "Save and re-assess" }),
    );

    await findNeeded("2100 kcal");
  });

  it("aborts an edit reload when the day changes and drops its late response", async () => {
    const user = userEvent.setup();
    const reload = deferred();
    const nextDay = deferred();
    let summaryLoads = 0;
    stubFetch({
      "/api/me": () => Promise.resolve(json(ATHLETE)),
      "/api/measurements": () => Promise.resolve(json({ metrics: [] })),
      [`/api/diet/summary?today=${DAY_TWO}`]: () => nextDay.promise,
      "/api/diet/summary": () => {
        summaryLoads += 1;
        return summaryLoads === 1
          ? Promise.resolve(json(summary(DAY_ONE, 2400)))
          : reload.promise;
      },
      "/api/diet/entries/7": () => Promise.resolve(json(meal(DAY_ONE))),
    });

    const { rerender } = render(page());
    await findNeeded("2400 kcal");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      screen.getByRole("button", { name: "Save and re-assess" }),
    );

    // The edit has already started reloading the first day's summary.
    await waitFor(() => expect(summaryCalls()).toHaveLength(2));

    // The athlete's day changes while that reload is still in flight.
    todayOverride = DAY_TWO;
    rerender(page());
    await waitFor(() => expect(summaryCalls()).toHaveLength(3));
    expect(summaryCalls()[1]?.signal?.aborted).toBe(true);

    await act(async () => {
      nextDay.resolve(json(summary(DAY_TWO, 1800)));
      await Promise.resolve();
    });
    await findNeeded("1800 kcal");

    // The superseded reload resolves last and must not replace the new day.
    await act(async () => {
      reload.resolve(json(summary(DAY_ONE, 2100)));
      await Promise.resolve();
    });
    await flush();

    expect(within(dietDays()).queryByText("2100 kcal")).toBeNull();
    expect(within(dietDays()).getByText("1800 kcal")).toBeDefined();
    expect(screen.queryByText(/^Error:/)).toBeNull();
  });
});
