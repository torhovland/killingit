import { useRef, useState } from "react";
import { reportError } from "../reportError";

export interface QueuedSave<T> {
  /** True while an attempt is in flight or still waiting in the queue. */
  saving: boolean;
  /** The newest attempt's failure, cleared when the next attempt starts. */
  error: string | null;
  /** Queues one attempt; attempts reach the server in enqueue order. */
  enqueue: (value: T) => void;
}

/**
 * Persists values one attempt at a time, in the order they were enqueued, and
 * lets only the newest attempt report its result. Rapid clicks therefore reach
 * the server in click order instead of racing, and an older attempt's answer
 * never replaces the newer choice. See
 * `docs/specs/llm-model-catalog.md`.
 */
export function useQueuedSave<T, R>(
  persist: (value: T) => Promise<R>,
  onSaved: (result: R) => void,
): QueuedSave<T> {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);

  function enqueue(value: T): void {
    const attempt = ++sequence.current;
    setSaving(true);
    setError(null);
    queue.current = queue.current
      .then(async () => {
        try {
          const result = await persist(value);
          if (attempt === sequence.current) onSaved(result);
        } catch (err: unknown) {
          if (attempt === sequence.current) setError(reportError(err));
        } finally {
          if (attempt === sequence.current) setSaving(false);
        }
      })
      .catch(() => {
        // The queued attempt above handles its own errors; keep the chain alive.
      });
  }

  return { saving, error, enqueue };
}
