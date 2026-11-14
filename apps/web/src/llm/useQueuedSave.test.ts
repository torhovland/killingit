import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useQueuedSave } from "./useQueuedSave";

interface PendingSave {
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** A save whose settlement the test controls, recording the order it starts. */
function deferredSave(): {
  persist: (value: string) => Promise<string>;
  started: string[];
  resolveNext: () => void;
  rejectNext: (error: unknown) => void;
} {
  const started: string[] = [];
  const pending: PendingSave[] = [];
  return {
    started,
    persist: (value: string) => {
      started.push(value);
      return new Promise<string>((resolve, reject) => {
        pending.push({ resolve: () => resolve(value), reject });
      });
    },
    resolveNext: () => pending.shift()?.resolve(),
    rejectNext: (error: unknown) => pending.shift()?.reject(error),
  };
}

/** Renders the hook with a deferred save and an optional saved callback. */
function renderSave(onSaved: (value: string) => void = () => undefined) {
  const save = deferredSave();
  const hook = renderHook(() =>
    useQueuedSave(save.persist, (value: string) => onSaved(value)),
  );
  return { save, hook };
}

/**
 * Runs one step of the hook and lets its queued microtask start before the
 * caller asserts, so the queue's next link is observable.
 */
async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await Promise.resolve();
  });
}

/** Queues every value in one step, as a burst of clicks would. */
async function enqueueAll(
  hook: ReturnType<typeof renderSave>["hook"],
  ...values: string[]
): Promise<void> {
  await settle(() => {
    for (const value of values) hook.result.current.enqueue(value);
  });
}

describe("useQueuedSave", () => {
  it("runs saves one at a time in enqueue order", async () => {
    const { save, hook } = renderSave();

    await enqueueAll(hook, "first", "second");
    expect(save.started).toEqual(["first"]);

    await settle(() => save.resolveNext());

    await waitFor(() => expect(save.started).toEqual(["first", "second"]));
  });

  it("keeps saving until the newest attempt settles", async () => {
    const { save, hook } = renderSave();
    expect(hook.result.current.saving).toBe(false);

    await enqueueAll(hook, "first");
    expect(hook.result.current.saving).toBe(true);

    await enqueueAll(hook, "second");
    expect(save.started).toEqual(["first"]);

    await settle(() => save.resolveNext());
    expect(hook.result.current.saving).toBe(true);

    await waitFor(() => expect(save.started).toEqual(["first", "second"]));
    await settle(() => save.resolveNext());
    await waitFor(() => expect(hook.result.current.saving).toBe(false));
  });

  it("hands only the newest result to the caller", async () => {
    const saved: string[] = [];
    const { save, hook } = renderSave((value) => saved.push(value));

    await enqueueAll(hook, "first", "second");
    await settle(() => save.resolveNext());
    await waitFor(() => expect(save.started).toEqual(["first", "second"]));
    expect(saved).toEqual([]);

    await settle(() => save.resolveNext());
    await waitFor(() => expect(saved).toEqual(["second"]));
  });

  it("shows the newest failure and clears it when another save starts", async () => {
    const { save, hook } = renderSave();

    await enqueueAll(hook, "broken");
    await settle(() => save.rejectNext(new Error("offline")));
    await waitFor(() => expect(hook.result.current.error).toBe("offline"));

    await enqueueAll(hook, "retry");
    expect(hook.result.current.error).toBe(null);
    expect(hook.result.current.saving).toBe(true);
  });

  it("keeps the queue alive after a failed save", async () => {
    const saved: string[] = [];
    const { save, hook } = renderSave((value) => saved.push(value));

    await enqueueAll(hook, "first", "second");
    await settle(() => save.rejectNext(new Error("offline")));
    await waitFor(() => expect(save.started).toEqual(["first", "second"]));

    await settle(() => save.resolveNext());
    await waitFor(() => expect(saved).toEqual(["second"]));
    expect(hook.result.current.error).toBe(null);
  });
});
