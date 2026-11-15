import { describe, expect, it, spyOn } from "bun:test";
import { createDatabasePool, resolveDatabaseUrl } from "./connection.js";

const LOCAL_URL = "postgres://killingit:killingit@localhost:5432/killingit";
const HOSTED_URL =
  "postgres://athlete:s3cret@ep-cool-db.eu-central-1.aws.neon.tech/killingit";

describe("resolveDatabaseUrl", () => {
  it("falls back to the local database in development and tests", () => {
    for (const nodeEnv of [undefined, "", "development", "test"]) {
      expect(resolveDatabaseUrl({ NODE_ENV: nodeEnv })).toBe(LOCAL_URL);
    }
  });

  it("falls back to the local database when DATABASE_URL is blank", () => {
    expect(
      resolveDatabaseUrl({ NODE_ENV: "development", DATABASE_URL: "   " }),
    ).toBe(LOCAL_URL);
    expect(resolveDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: "" })).toBe(
      LOCAL_URL,
    );
  });

  it("requires DATABASE_URL outside development and tests", () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: "production" })).toThrow(
      'DATABASE_URL is required when NODE_ENV is "production"',
    );
    expect(() => resolveDatabaseUrl({ NODE_ENV: "staging" })).toThrow(
      'DATABASE_URL is required when NODE_ENV is "staging"',
    );
    expect(() =>
      resolveDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: "" }),
    ).toThrow("DATABASE_URL is required");
  });

  it("never echoes the connection string in the error", () => {
    // The configured value carries credentials, so the failure names only what
    // is missing and the environment it was missing in.
    let message = "";
    try {
      resolveDatabaseUrl({ NODE_ENV: "production" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("postgres://");
  });

  it("returns a configured local URL unchanged", () => {
    const url = "postgres://athlete:secret@127.0.0.1:5432/killingit";
    expect(
      resolveDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: url }),
    ).toBe(url);
  });

  it("trims a configured URL", () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: ` ${LOCAL_URL}\n`,
      }),
    ).toBe(LOCAL_URL);
  });

  it("requires TLS for a hosted database that omits sslmode", () => {
    expect(
      resolveDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: HOSTED_URL }),
    ).toBe(`${HOSTED_URL}?sslmode=require`);
  });

  it("adds sslmode to a hosted URL that already has a query string", () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: `${HOSTED_URL}?application_name=killingit`,
      }),
    ).toBe(`${HOSTED_URL}?application_name=killingit&sslmode=require`);
  });

  it("keeps an explicit sslmode", () => {
    for (const sslmode of ["require", "disable", "verify-full"]) {
      const url = `${HOSTED_URL}?sslmode=${sslmode}`;
      expect(
        resolveDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: url }),
      ).toBe(url);
    }
  });
});

describe("createDatabasePool", () => {
  it("builds the pool over the connection string it is given", async () => {
    const pool = createDatabasePool(LOCAL_URL);
    try {
      expect(pool.options.connectionString).toBe(LOCAL_URL);
    } finally {
      await pool.end();
    }
  });

  it("logs an idle-client error instead of letting it crash the process", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const pool = createDatabasePool(LOCAL_URL);
    try {
      // pg emits `error` on the pool when an idle client fails; without a
      // listener Node treats that as an unhandled event and exits.
      const error = new Error(
        "terminating connection due to administrator command",
      );
      expect(() => pool.emit("error", error)).not.toThrow();
      expect(log).toHaveBeenCalledWith("[db] idle client error:", error);
    } finally {
      await pool.end();
      log.mockRestore();
    }
  });
});
