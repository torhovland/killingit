import "./config.js";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach } from "bun:test";
import {
  closeIntegrationDatabase,
  prepareIntegrationDatabase,
  truncateAllTables,
  type MigrationResult,
} from "./database.js";

/**
 * Shared setup for every database-backed suite. Bun runs the test files
 * sequentially in one process, so this module's promise and counter survive
 * from file to file: the first file migrates and every later file awaits the
 * same result instead of rebuilding the schema.
 */

let prepared: Promise<MigrationResult> | undefined;

/**
 * Every file that calls `setupIntegrationSuite` is one of these. Counting the
 * files rather than their imports lets the last file of a full run close the
 * shared pool exactly once, while a single-file run simply lets the process
 * exit.
 */
const suiteFiles = readdirSync(import.meta.dir).filter((file) =>
  file.endsWith(".integration.test.ts"),
);
let suitesPending = suiteFiles.length;

/**
 * Registers the hooks every database suite needs: migrate once for the whole
 * run, clear the administrator setting and every table before each test, and
 * close the shared pool after the last file. The suite that asserts on the
 * migration result receives it through `onMigrated`.
 */
export function setupIntegrationSuite(
  onMigrated?: (result: MigrationResult) => void,
): void {
  beforeAll(async () => {
    prepared ??= prepareIntegrationDatabase();
    // Await the promise on its own line. Writing
    // `onMigrated?.(await prepared)` would skip the await whenever the callback
    // is absent, leaving the schema build racing the tests.
    const result = await prepared;
    onMigrated?.(result);
  });

  beforeEach(async () => {
    // Every test starts with no configured administrator, so a test that grants
    // one cannot leak the setting into the next test.
    delete process.env.ADMIN_AUTH_SUBJECT;
    await truncateAllTables();
  });

  afterAll(async () => {
    suitesPending -= 1;
    if (suitesPending === 0) {
      await closeIntegrationDatabase();
    }
  });
}
