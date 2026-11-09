/**
 * Connection settings for the database-backed integration suite. Importing
 * this module points the API's own `DATABASE_URL` at the test database before
 * `src/db/index.ts` is evaluated, so the suite can never touch a development
 * database by accident.
 */

const DEFAULT_INTEGRATION_DATABASE_URL =
  "postgres://killingit:killingit@localhost:5432/killingit_test";

function databaseName(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

export const integrationDatabaseUrl =
  process.env.INTEGRATION_DATABASE_URL ?? DEFAULT_INTEGRATION_DATABASE_URL;

export const integrationDatabaseName = databaseName(integrationDatabaseUrl);

if (!integrationDatabaseName.endsWith("_test")) {
  throw new Error(
    `Refusing to run integration tests against "${integrationDatabaseName}": ` +
      "the database name must end in _test. Set INTEGRATION_DATABASE_URL.",
  );
}

process.env.DATABASE_URL = integrationDatabaseUrl;
