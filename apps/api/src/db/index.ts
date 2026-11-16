import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool, resolveDatabaseUrl } from "./connection.js";
import * as schema from "./schema.js";

const pool = createDatabasePool(resolveDatabaseUrl());

/** The Drizzle client over this module's PostgreSQL pool. */
export const db = drizzle(pool, { schema });

/** One transaction on this module's pool, so a multi-step write stays atomic. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The shared connection or one transaction on it, so a write can be atomic. */
export type DbExecutor = typeof db | DbTransaction;
