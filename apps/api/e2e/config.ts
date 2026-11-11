/**
 * Connection settings for the end-to-end suite. Importing this module points
 * the API's own `DATABASE_URL` at the e2e test database before
 * `src/db/index.ts` is evaluated, so the suite can never touch a development
 * database by accident.
 */

const DEFAULT_E2E_DATABASE_URL =
  "postgres://killingit:killingit@localhost:5432/killingit_e2e_test";

function databaseName(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

export const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;

export const e2eDatabaseName = databaseName(e2eDatabaseUrl);

if (!e2eDatabaseName.endsWith("_test")) {
  throw new Error(
    `Refusing to run e2e tests against "${e2eDatabaseName}": ` +
      "the database name must end in _test. Set E2E_DATABASE_URL.",
  );
}

process.env.DATABASE_URL = e2eDatabaseUrl;

/** Port the API process listens on for the suite. */
export const E2E_API_PORT = 3101;
/** Stable bearer token the fake web auth adapter sends. */
export const E2E_AUTH_TOKEN = "e2e-token";
/** Auth subject the test API resolves to the seeded athlete. */
export const E2E_ATHLETE_SUB = "e2e|athlete";
