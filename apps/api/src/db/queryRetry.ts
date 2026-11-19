import type pg from "pg";

/**
 * Failures that prove the statement never reached the server, so running it
 * again cannot apply a write twice. `Connection terminated unexpectedly` is
 * deliberately absent: the server may already have executed the statement, and
 * retrying an `INSERT` could duplicate it.
 */
const UNSENT_STATEMENT_ERRORS = [
  "Socket is closed",
  "Authentication timed out",
  "Connection terminated due to connection timeout",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ETIMEDOUT",
];

/** True when a failed connection never carried its statement to the server. */
function statementWasNotSent(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return UNSENT_STATEMENT_ERRORS.some((text) => error.message.includes(text));
}

/**
 * Runs a query, and runs it once more when the first attempt failed before the
 * server received it. A second failure is returned to the caller: a pool that
 * keeps failing is a real outage, not something a retry should hide.
 */
async function retryOnceOnConnectionError<T>(
  query: () => Promise<T>,
): Promise<T> {
  try {
    return await query();
  } catch (error: unknown) {
    if (!statementWasNotSent(error)) {
      throw error;
    }
    return query();
  }
}

/**
 * Wraps the pool's `query` so a statement that never reached the server is
 * attempted once more on a fresh connection. A transaction checks out its own
 * client instead of going through the pool, so it is untouched: it fails as a
 * whole and its caller decides what to do. See
 * `docs/specs/database-connection.md`.
 */
export function withConnectionRetry(pool: pg.Pool): pg.Pool {
  // The callback overload of `query` is not used by Drizzle, so the wrapper
  // keeps the promise form and casts back to the pool's overloaded method.
  const query = pool.query.bind(pool) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const retrying = (...args: unknown[]): Promise<unknown> =>
    retryOnceOnConnectionError(() => query(...args));
  pool.query = retrying as typeof pool.query;
  return pool;
}
