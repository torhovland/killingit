/**
 * A Map with a fixed number of entries. Writing a key makes it the newest
 * entry, reading it with `get` refreshes that position, and the least recently
 * used key is evicted when a new key would cross the limit. `has` is a plain
 * existence check and does not refresh an entry.
 *
 * These maps live in one process only. A bound keeps their memory predictable;
 * it cannot make a guarantee hold on another Cloud Run instance. See ADR 0014.
 */
export class BoundedMap<K, V> {
  readonly #entries = new Map<K, V>();
  readonly #limit: number;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("A BoundedMap needs a positive integer limit.");
    }
    this.#limit = limit;
  }

  /** Reads a value and marks its key as the most recently used. */
  get(key: K): V | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  /** Reports whether a key is still remembered without refreshing it. */
  has(key: K): boolean {
    return this.#entries.has(key);
  }

  /** Writes a value as the newest entry, evicting the oldest keys. */
  set(key: K, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) {
        return;
      }
      this.#entries.delete(oldest.value);
    }
  }
}

/**
 * One timestamp per key, remembered only for the window it can still affect.
 * Recording prunes every entry at or before the window's start, so the map
 * holds at most the keys touched inside the window instead of every key ever
 * seen. It is process-local, like the other maps in this module.
 */
export class RecentTimestampMap {
  readonly #times = new Map<number, number>();

  /**
   * Records `at` for `key` and returns the previous timestamp when that is
   * still inside the window ending at `at`.
   */
  record(key: number, at: number, windowMs: number): number | null {
    for (const [entryKey, entryAt] of this.#times) {
      if (at - entryAt >= windowMs) {
        this.#times.delete(entryKey);
      }
    }
    const previous = this.#times.get(key) ?? null;
    this.#times.set(key, at);
    return previous;
  }
}
