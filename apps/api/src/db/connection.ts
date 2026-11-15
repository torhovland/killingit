import pg from "pg";

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
 * A pool over `connectionString`. When an idle client fails (a Neon failover, a
 * dropped connection), pg emits `error` on the pool; without a listener Node
 * treats that as an unhandled event and exits the process. Log the error, which
 * does not include the connection string, and let pg discard the client.
 */
export function createDatabasePool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString });
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error);
  });
  return pool;
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
