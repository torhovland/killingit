import type { PlanGenerateMode } from "@killingit/shared";
import { RecentTimestampMap } from "../lib/boundedMap.js";

/**
 * Rapid auto triggers are coalesced for this long. A first trigger starts
 * immediately; a second one inside the window replaces it and starts when the
 * window closes, so saving several inputs in a row does not pay for several
 * aborted plan completions.
 */
export const PLAN_TRIGGER_DEBOUNCE_MS = 1_500;

/** The debounce inputs one trigger supplies for its own call. */
export interface PlanTriggerTiming {
  mode?: PlanGenerateMode | undefined;
  force?: boolean | undefined;
  /** The window, so an injected test window still reaches every call. */
  windowMs: number;
}

/**
 * The plan triggers waiting in this process, per account. A class rather than
 * module globals so a test can own an isolated instance while production keeps
 * one instance in `plans/trigger.ts`.
 *
 * The state is process-local on purpose. On scale-out each instance debounces
 * the requests it receives, and the database run id still fences every write.
 * See ADR 0014 and `docs/specs/coach-run-cancellation.md`.
 */
export class PlanTriggerDebounce {
  /**
   * Only the accounts waiting for their window, as a timer that removes its
   * own entry when it fires and is replaced by a newer trigger.
   */
  readonly #pendingStarts = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * The last trigger time per account, pruned to the current window. An older
   * time cannot affect a wait calculation, so it is dropped instead of kept for
   * every account that ever generated a plan.
   */
  readonly #lastTriggerAt = new RecentTimestampMap();

  /**
   * Starts `start` now, or replaces the account's pending trigger and runs it
   * when the window closes. An explicit new season, update season or forced
   * run never waits.
   */
  schedule(
    userId: number,
    { mode, force, windowMs }: PlanTriggerTiming,
    start: () => void,
  ): void {
    this.#cancelPending(userId);

    const explicit =
      mode === "newSeason" || mode === "updateSeason" || force === true;
    const now = Date.now();
    const previousAt = this.#lastTriggerAt.record(userId, now, windowMs);
    const waitMs =
      explicit || previousAt === null
        ? 0
        : Math.max(0, windowMs - (now - previousAt));

    if (waitMs === 0) {
      start();
      return;
    }

    const timer = setTimeout(() => {
      this.#pendingStarts.delete(userId);
      start();
    }, waitMs);
    // A waiting trigger must not keep the process alive on shutdown.
    timer.unref();
    this.#pendingStarts.set(userId, timer);
  }

  /** Drops the account's waiting trigger, so it can never start. */
  #cancelPending(userId: number): void {
    const pending = this.#pendingStarts.get(userId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending);
    this.#pendingStarts.delete(userId);
  }
}
