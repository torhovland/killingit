/** How long the dashboard waits between polls for a coach reply. */
const COACH_REPLY_POLL_INTERVAL_MS = 1500;

/**
 * How many times the dashboard asks for a reply before it stops polling, so a
 * reply the coach never stores cannot keep the page polling for the whole
 * visit.
 */
const COACH_REPLY_POLL_ATTEMPTS = 40;

export interface PollCoachRepliesOptions {
  /** Loads and applies the cached feed once; resolves once it is on screen. */
  loadCached: () => Promise<void>;
  /** Whether the reply is still wanted; false once answered or unmounted. */
  isActive: () => boolean;
  /** Waits before an attempt; injected so tests do not wait for real time. */
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  attempts?: number;
}

/**
 * Poll the stored server feed for the coach's reply, one request at a time.
 * The next attempt only starts after the previous response has settled, so a
 * slow response can neither overlap with a later one nor be applied out of
 * order. See `docs/specs/coach-reply-polling.md`.
 */
export async function pollCoachReplies({
  loadCached,
  isActive,
  sleep = wait,
  intervalMs = COACH_REPLY_POLL_INTERVAL_MS,
  attempts = COACH_REPLY_POLL_ATTEMPTS,
}: PollCoachRepliesOptions): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(intervalMs);
    if (!isActive()) {
      return;
    }
    try {
      await loadCached();
    } catch {
      // The loader reports its own failure; one bad tick must not end the poll.
    }
  }
}

/** Waits before a poll; kept in one place so tests can replace it. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
