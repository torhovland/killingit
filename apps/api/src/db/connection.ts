import pg from "pg";
import { withConnectionRetry } from "./queryRetry.js";

/**
 * The local docker-compose database, used when development and test runs leave
 * `DATABASE_URL` unset. A deployed process must configure its own database
 * instead: falling back to localhost there fails with a connection error that
 * never mentions the missing setting.
 */
const LOCAL_DATABASE_URL =
  "postgres://killingit:killingit@localhost:5432/killingit";

/**
 * The `NODE_ENV` values treated as development or test, where the local
 * fallback is allowed. An unset or blank value means development, which is what
 * `bun run dev` and `bun run start` run with.
 */
const LOCAL_ENVIRONMENTS = new Set(["", "development", "test"]);

/**
 * The effective PostgreSQL connection string for this process.
 *
 * A missing or blank `DATABASE_URL` falls back to the local database only in
 * development and tests; anywhere else it throws, so a misconfigured deploy
 * fails at startup with the missing variable named. A hosted connection string
 * that omits `sslmode` gains `sslmode=require`, because Neon and other hosted
 * Postgres refuse insecure connections. Neither the error nor the returned
 * value is logged: the string carries credentials.
 */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.DATABASE_URL?.trim();
  const nodeEnv = env.NODE_ENV?.trim() ?? "";

  if (configured === undefined || configured === "") {
    if (!LOCAL_ENVIRONMENTS.has(nodeEnv)) {
      throw new Error(
        `DATABASE_URL is required when NODE_ENV is "${nodeEnv}"; ` +
          "set it to this environment's PostgreSQL connection string.",
      );
    }
    return LOCAL_DATABASE_URL;
  }

  return withRequiredSsl(configured);
}

/**
 * How long pg waits for a new connection before failing its query. Without a
 * bound, a dropped Neon connection leaves a request waiting on the socket.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * How long an unused connection is kept. Neon and its pooler drop idle
 * connections on their own schedule, so recycle ours first.
 */
const IDLE_TIMEOUT_MS = 30_000;

/** How many queries one connection serves before it is replaced. */
const MAX_USES = 7_500;

/**
 * A pool over `connectionString`. When an idle client fails (a Neon failover, a
 * dropped connection), pg emits `error` on the pool; without a listener Node
 * treats that as an unhandled event and exits the process. Log the error, which
 * does not include the connection string, and let pg discard the client.
 *
 * The connection bounds keep a dead socket from being waited on forever, and
 * `withConnectionRetry` retries the one failure a fresh connection can fix.
 */
export function createDatabasePool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    maxUses: MAX_USES,
    keepAlive: true,
  });
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error);
  });
  return withConnectionRetry(pool);
}

/**
 * Appends `sslmode=require` to a hosted connection string that omits any
 * `sslmode`, so we never fail with "connection is insecure" against Neon.
 */
function withRequiredSsl(connectionString: string): string {
  const isLocal = /localhost|127\.0\.0\.1|::1/i.test(connectionString);
  const needsSsl = !isLocal && !/sslmode=/.test(connectionString);
  if (!needsSsl) {
    return connectionString;
  }
  const separator = connectionString.includes("?") ? "&" : "?";
  return `${connectionString}${separator}sslmode=require`;
}
