import "./config.js";
import {
  prepareTestDatabase,
  type MigrationResult,
} from "../testDatabase/database.js";
import { integrationDatabaseUrl } from "./config.js";

export {
  closeTestDatabase as closeIntegrationDatabase,
  countRows,
  listPublicTables,
  truncateAllTables,
} from "../testDatabase/database.js";
export type { MigrationResult } from "../testDatabase/database.js";

/** Creates the integration test database when needed and migrates it. */
export function prepareIntegrationDatabase(): Promise<MigrationResult> {
  return prepareTestDatabase(integrationDatabaseUrl);
}
