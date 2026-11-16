import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool, resolveDatabaseUrl } from "./connection.js";
import * as schema from "./schema.js";

const pool = createDatabasePool(resolveDatabaseUrl());

/** The Drizzle client over this module's PostgreSQL pool. */
export const db = drizzle(pool, { schema });
