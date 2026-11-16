import { describe, expect, it, spyOn } from "bun:test";
import { PlanTriggerDebounce } from "./triggerDebounce.js";

/** Lets the real timers a test scheduled fire. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Waits until the scheduled starts reach the expected count. */
async function waitForStarts(starts: string[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && starts.length < count; attempt += 1) {
    await settle();
  }
}

describe("PlanTriggerDebounce", () => {
  it("starts the first trigger for an account immediately", () => {
    const debounce = new PlanTriggerDebounce();
    const starts: string[] = [];

    debounce.schedule(1, { windowMs: 1_000 }, () => starts.push("first"));

    expect(starts).toEqual(["first"]);
  });

  it("replaces a pending trigger and starts only the newest one", async () => {
    const debounce = new PlanTriggerDebounce();
    const starts: string[] = [];

    debounce.schedule(1, { windowMs: 0 }, () => starts.push("first"));
    debounce.schedule(1, { windowMs: 20 }, () => starts.push("second"));
    debounce.schedule(1, { windowMs: 20 }, () => starts.push("third"));

    // The second trigger is still inside its window when the third replaces it.
    expect(starts).toEqual(["first"]);

    await waitForStarts(starts, 2);

    expect(starts).toEqual(["first", "third"]);
  });

  it("keeps accounts' pending triggers apart", async () => {
    const debounce = new PlanTriggerDebounce();
    const starts: string[] = [];

    debounce.schedule(1, { windowMs: 0 }, () => starts.push("account 1"));
    debounce.schedule(2, { windowMs: 30 }, () => starts.push("account 2"));
    debounce.schedule(1, { windowMs: 10 }, () =>
      starts.push("account 1 again"),
    );

    await waitForStarts(starts, 3);

    expect(starts).toEqual(["account 1", "account 2", "account 1 again"]);
  });

  it.each([
    ["a new season", { mode: "newSeason" as const }],
    ["an updated season", { mode: "updateSeason" as const }],
    ["a forced run", { force: true }],
  ])("does not delay %s", (_label, timing) => {
    const debounce = new PlanTriggerDebounce();
    const starts: string[] = [];

    debounce.schedule(1, { windowMs: 60_000 }, () => starts.push("first"));
    debounce.schedule(1, { ...timing, windowMs: 60_000 }, () =>
      starts.push("explicit"),
    );

    expect(starts).toEqual(["first", "explicit"]);
  });

  it("takes the debounce window from each call", async () => {
    const debounce = new PlanTriggerDebounce();
    const starts: string[] = [];

    debounce.schedule(1, { windowMs: 60_000 }, () => starts.push("first"));
    // The injected window is not fixed when the instance is created: a zero
    // window from the dependency object starts the next trigger at once.
    debounce.schedule(1, { windowMs: 0 }, () => starts.push("immediate"));
    debounce.schedule(1, { windowMs: 20 }, () => starts.push("waiting"));

    await waitForStarts(starts, 3);

    expect(starts).toEqual(["first", "immediate", "waiting"]);
  });

  it("does not keep the process alive while a trigger waits", () => {
    const debounce = new PlanTriggerDebounce();
    const realSetTimeout = globalThis.setTimeout;
    const unrefs: number[] = [];
    const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
      handler: () => void,
      ms?: number,
    ) => {
      const timer = realSetTimeout(handler, ms);
      const unref = timer.unref.bind(timer);
      timer.unref = () => {
        unrefs.push(1);
        return unref();
      };
      return timer;
    }) as unknown as typeof setTimeout);

    try {
      debounce.schedule(1, { windowMs: 0 }, () => {});
      debounce.schedule(1, { windowMs: 1_000 }, () => {});
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect(unrefs).toHaveLength(1);
  });
});
