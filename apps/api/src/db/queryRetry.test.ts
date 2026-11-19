import { describe, expect, it } from "bun:test";
import type pg from "pg";
import { withConnectionRetry } from "./queryRetry.js";

/** A pool-shaped object whose query is replaced by the wrapper. */
function poolWithQuery(query: () => Promise<unknown>): pg.Pool {
  return { query } as unknown as pg.Pool;
}

/** Calls the wrapped pool's promise form; `pg.Pool["query"]` is overloaded. */
function run(pool: pg.Pool): Promise<unknown> {
  const query = pool.query.bind(pool) as (text: string) => Promise<unknown>;
  return query("select 1");
}

describe("withConnectionRetry", () => {
  it("runs a query again when the socket closed before the statement was sent", async () => {
    let attempts = 0;
    const pool = poolWithQuery(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("Socket is closed"))
        : Promise.resolve("rows");
    });

    const result = await run(withConnectionRetry(pool));

    expect(result).toBe("rows");
    expect(attempts).toBe(2);
  });

  it("retries a connection attempt that timed out during authentication", async () => {
    let attempts = 0;
    const pool = poolWithQuery(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("Authentication timed out"))
        : Promise.resolve("rows");
    });

    const result = await run(withConnectionRetry(pool));

    expect(result).toBe("rows");
    expect(attempts).toBe(2);
  });

  it("does not run a query twice when the server may have applied it", async () => {
    let attempts = 0;
    const pool = poolWithQuery(() => {
      attempts += 1;
      return Promise.reject(new Error("Connection terminated unexpectedly"));
    });
    let caught: unknown = null;

    try {
      await run(withConnectionRetry(pool));
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe(
      "Connection terminated unexpectedly",
    );
    expect(attempts).toBe(1);
  });

  it("does not retry an ordinary query error", async () => {
    let attempts = 0;
    const pool = poolWithQuery(() => {
      attempts += 1;
      return Promise.reject(new Error("duplicate key value"));
    });
    let caught: unknown = null;

    try {
      await run(withConnectionRetry(pool));
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe("duplicate key value");
    expect(attempts).toBe(1);
  });

  it("returns the second failure without a third attempt", async () => {
    let attempts = 0;
    const failure = new Error("Socket is closed");
    const pool = poolWithQuery(() => {
      attempts += 1;
      return Promise.reject(failure);
    });
    let caught: unknown = null;

    try {
      await run(withConnectionRetry(pool));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);
    expect(attempts).toBe(2);
  });
});
