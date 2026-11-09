import "./config.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { db, pool } from "../src/db/index.js";
import { integrationDatabaseName, integrationDatabaseUrl } from "./config.js";

const MIGRATIONS_FOLDER = join(import.meta.dir, "..", "drizzle");
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/i;

export interface MigrationResult {
  /** Rows recorded by drizzle after applying the folder. */
  applied: number;
  /** `.sql` migration files in the folder. */
  expected: number;
}

function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

/** Connects to the maintenance database so a missing test database can be made. */
async function ensureDatabaseExists(): Promise<void> {
  const maintenanceUrl = new URL(integrationDatabaseUrl);
  maintenanceUrl.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      "select 1 from pg_database where datname = $1",
      [integrationDatabaseName],
    );
    if (existing.rowCount === 0) {
      await client.query(
        `create database ${quoteIdentifier(integrationDatabaseName)}`,
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Rebuilds an empty schema and applies every migration. Dropping the drizzle
 * schema as well resets its bookkeeping, so the suite proves the full chain
 * applies from nothing on every run.
 */
async function rebuildSchema(): Promise<MigrationResult> {
  await pool.query("drop schema if exists public cascade");
  await pool.query("drop schema if exists drizzle cascade");
  await pool.query("create schema public");

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const files = (await readdir(MIGRATIONS_FOLDER)).filter((file) =>
    file.endsWith(".sql"),
  );
  const result = await pool.query<{ count: number }>(
    "select count(*)::int as count from drizzle.__drizzle_migrations",
  );

  return {
    applied: result.rows[0]?.count ?? 0,
    expected: files.length,
  };
}

/** Creates the test database when needed and migrates it from an empty schema. */
export async function prepareIntegrationDatabase(): Promise<MigrationResult> {
  await ensureDatabaseExists();
  return rebuildSchema();
}

/** Clears every table between tests without disturbing the migration record. */
export async function truncateAllTables(): Promise<void> {
  const result = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const tables = result.rows.map((row) => quoteIdentifier(row.tablename));
  if (tables.length === 0) {
    return;
  }
  await pool.query(
    `truncate table ${tables.join(", ")} restart identity cascade`,
  );
}

/** Lists every table in the rebuilt public schema. */
export async function listPublicTables(): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  return result.rows.map((row) => row.table_name);
}

/** Counts the rows in one public table, for cascade and upsert assertions. */
export async function countRows(table: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `select count(*)::int as count from ${quoteIdentifier(table)}`,
  );
  return result.rows[0]?.count ?? 0;
}

/** Ends the shared pool once the suite has finished. */
export async function closeIntegrationDatabase(): Promise<void> {
  await pool.end();
}
