import { describe, expect, it } from "bun:test";
import {
  COACH_REPLY_POLL_ATTEMPTS,
  COACH_REPLY_POLL_INTERVAL_MS,
  pollCoachReplies,
} from "./coachReplyPoll";

/** Lets the poll's awaits and the test's own microtasks run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("pollCoachReplies", () => {
  it("starts the next request only after the previous one has settled", async () => {
    const order: string[] = [];
    const pending: Array<() => void> = [];
    const poll = pollCoachReplies({
      loadCached: () => {
        order.push("load");
        return new Promise<void>((resolve) => pending.push(resolve));
      },
      sleep: () => {
        order.push("sleep");
        return Promise.resolve();
      },
      isActive: () => true,
      attempts: 2,
    });

    await settle();
    expect(order).toEqual(["sleep", "load"]);

    pending.shift()?.();
    await settle();
    expect(order).toEqual(["sleep", "load", "sleep", "load"]);

    pending.shift()?.();
    await poll;
    expect(order).toEqual(["sleep", "load", "sleep", "load"]);
  });

  it("gives up after the documented number of attempts", async () => {
    const waits: number[] = [];
    let loads = 0;

    await pollCoachReplies({
      loadCached: () => {
        loads += 1;
        return Promise.resolve();
      },
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      isActive: () => true,
    });

    expect(loads).toBe(COACH_REPLY_POLL_ATTEMPTS);
    expect(waits).toHaveLength(COACH_REPLY_POLL_ATTEMPTS);
    expect(new Set(waits)).toEqual(new Set([COACH_REPLY_POLL_INTERVAL_MS]));
  });

  it("stops without another request once the caller is no longer active", async () => {
    let active = true;
    let loads = 0;

    await pollCoachReplies({
      loadCached: () => {
        loads += 1;
        active = false;
        return Promise.resolve();
      },
      sleep: () => Promise.resolve(),
      isActive: () => active,
    });

    expect(loads).toBe(1);
  });

  it("keeps polling after a failed request", async () => {
    let loads = 0;

    await pollCoachReplies({
      loadCached: () => {
        loads += 1;
        return loads === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve();
      },
      sleep: () => Promise.resolve(),
      isActive: () => true,
      attempts: 2,
    });

    expect(loads).toBe(2);
  });
});
