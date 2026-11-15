import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://killingit:killingit@localhost:5432/killingit";

// Neon (and any non-local Postgres) requires TLS. Append sslmode=require when
// the connection string omits it, so we never fail with
// "connection is insecure" against a hosted database.
const isLocal = /localhost|127\.0\.0\.1|::1/i.test(connectionString);
const needsSsl = !isLocal && !/sslmode=/.test(connectionString);
const effectiveUrl = needsSsl
  ? `${connectionString}${connectionString.includes("?") ? "&" : "?"}sslmode=require`
  : connectionString;

const pool = new pg.Pool({ connectionString: effectiveUrl });

/** The Drizzle client over this module's PostgreSQL pool. */
export const db = drizzle(pool, { schema });
