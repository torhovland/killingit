import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(import.meta.dir, "agent.sh");

// The script reads these from the caller's environment. Every test starts from a
// clean slate for them, so a developer's Neon URLs or a read-only `PGOPTIONS`
// cannot change what the stub programs record.
const CLEARED_VARIABLES = new Set([
  "DATABASE_URL",
  "DATABASE_URL_TEST",
  "DATABASE_URL_PROD",
  "GCP_PROJECT",
  "PGOPTIONS",
]);

interface AgentRun {
  exitCode: number;
  stderr: string;
  psql: string[];
  gcloud: string[];
  psqlPgOptions: string | null;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function stubSource(program: string): string {
  if (program === "psql") {
    return [
      "#!/bin/sh",
      'printf "%s\\n" "${PGOPTIONS:-}" >> "$STUB_LOG/psql.pgoptions"',
      'printf "%s\\n" "$@" >> "$STUB_LOG/psql.argv"',
      "",
    ].join("\n");
  }
  return [
    "#!/bin/sh",
    'printf "%s\\n" "$@" >> "$STUB_LOG/gcloud.argv"',
    "",
  ].join("\n");
}

async function runAgent(
  args: string[],
  variables: Record<string, string> = {},
): Promise<AgentRun> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-script-"));
  temporaryDirectories.push(directory);
  const logDirectory = path.join(directory, "log");
  await mkdir(logDirectory);

  for (const program of ["gcloud", "psql"]) {
    const file = path.join(directory, program);
    await writeFile(file, stubSource(program));
    await chmod(file, 0o755);
  }

  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !CLEARED_VARIABLES.has(key)) {
      environment[key] = value;
    }
  }
  Object.assign(environment, {
    GCP_PROJECT: "test-project",
    PATH: `${directory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    STUB_LOG: logDirectory,
  });
  Object.assign(environment, variables);

  const child = Bun.spawn(["bash", SCRIPT, ...args], {
    env: environment,
    stderr: "pipe",
    stdout: "ignore",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);

  const psqlArgs = await readIfExists(path.join(logDirectory, "psql.argv"));
  const gcloudArgs = await readIfExists(path.join(logDirectory, "gcloud.argv"));
  const pgOptions = await readIfExists(
    path.join(logDirectory, "psql.pgoptions"),
  );

  return {
    exitCode,
    stderr,
    psql:
      psqlArgs === null
        ? []
        : psqlArgs.split("\n").filter((line) => line !== ""),
    gcloud:
      gcloudArgs === null
        ? []
        : gcloudArgs.split("\n").filter((line) => line !== ""),
    psqlPgOptions: pgOptions === null ? null : pgOptions.trim(),
  };
}

const TEST_URL = "postgres://test";
const PROD_URL = "postgres://prod";

describe("agent.sh sql", () => {
  it("uses the test database variable for --env test", async () => {
    const run = await runAgent(["sql", "SELECT 1", "--env", "test"], {
      DATABASE_URL_PROD: PROD_URL,
      DATABASE_URL_TEST: TEST_URL,
    });

    expect(run.exitCode).toBe(0);
    expect(run.psql).toContain(TEST_URL);
    expect(run.psql).not.toContain(PROD_URL);
    expect(run.psql).toContain("SELECT 1");
    expect(run.stderr).toContain("Neon (test");
  });

  it("defaults to the test database", async () => {
    const run = await runAgent(["sql", "SELECT 1"], {
      DATABASE_URL_PROD: PROD_URL,
      DATABASE_URL_TEST: TEST_URL,
    });

    expect(run.exitCode).toBe(0);
    expect(run.psql).toContain(TEST_URL);
    expect(run.psql).not.toContain(PROD_URL);
  });

  it("uses the production database only when --env prod is given", async () => {
    const run = await runAgent(["sql", "SELECT 1", "--env", "prod"], {
      DATABASE_URL_PROD: PROD_URL,
      DATABASE_URL_TEST: TEST_URL,
    });

    expect(run.exitCode).toBe(0);
    expect(run.psql).toContain(PROD_URL);
    expect(run.psql).not.toContain(TEST_URL);
  });

  it("opens a read-only session by default", async () => {
    const run = await runAgent(["sql", "UPDATE users SET name = 'x'"], {
      DATABASE_URL_TEST: TEST_URL,
    });

    expect(run.exitCode).toBe(0);
    expect(run.psqlPgOptions).toBe("-c default_transaction_read_only=on");
    expect(run.stderr).toContain("read-only");
  });

  it("opens a read-write session only with --write", async () => {
    const run = await runAgent(["sql", "DELETE FROM users", "--write"], {
      DATABASE_URL_TEST: TEST_URL,
    });

    expect(run.exitCode).toBe(0);
    expect(run.psqlPgOptions).toBe("");
    expect(run.stderr).toContain("read-write");
  });

  it("names an unset database variable and prints usage", async () => {
    const run = await runAgent(["sql", "SELECT 1"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("DATABASE_URL_TEST is not set");
    expect(run.stderr).toContain("Usage:");
    expect(run.stderr).not.toContain("unbound variable");
    expect(run.psql).toEqual([]);
  });

  it("does not fall back to the other environment's variable", async () => {
    const run = await runAgent(["sql", "SELECT 1"], {
      DATABASE_URL_PROD: PROD_URL,
    });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("DATABASE_URL_TEST is not set");
    expect(run.psql).toEqual([]);
  });
});

describe("agent.sh logs", () => {
  it("reads the sidecar service for the garmin argument", async () => {
    const test = await runAgent(["logs", "garmin"]);
    expect(test.exitCode).toBe(0);
    expect(test.gcloud).toContain("killingit-garmin-test");
    expect(test.gcloud).toContain("100");

    const prod = await runAgent(["logs", "garmin", "--env", "prod"]);
    expect(prod.exitCode).toBe(0);
    expect(prod.gcloud).toContain("killingit-garmin");
  });

  it("reads the API service for the api argument", async () => {
    const run = await runAgent(["logs", "api", "--tail", "25"]);

    expect(run.exitCode).toBe(0);
    expect(run.gcloud).toContain("killingit-api-test");
    expect(run.gcloud).toContain("25");
  });
});

describe("agent.sh usage", () => {
  it("prints usage for a missing command", async () => {
    const run = await runAgent([]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("missing command");
    expect(run.stderr).toContain("Usage:");
  });

  it("prints usage for unknown commands", async () => {
    const run = await runAgent(["deploy"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("unknown command: deploy");
    expect(run.stderr).toContain("Usage:");
  });

  it("prints usage for a missing query", async () => {
    const run = await runAgent(["sql"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("sql requires a query");
    expect(run.stderr).toContain("Usage:");
  });

  it("prints usage for a missing --env value", async () => {
    const run = await runAgent(["sql", "SELECT 1", "--env"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("--env requires");
    expect(run.stderr).toContain("Usage:");
  });

  it("refuses an unknown environment", async () => {
    const run = await runAgent(["sql", "SELECT 1", "--env", "staging"], {
      DATABASE_URL_PROD: PROD_URL,
      DATABASE_URL_TEST: TEST_URL,
    });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("unknown environment: staging");
    expect(run.stderr).toContain("Usage:");
    expect(run.psql).toEqual([]);
  });

  it("refuses an unknown service", async () => {
    const run = await runAgent(["logs", "database"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("unknown service: database");
    expect(run.stderr).toContain("Usage:");
    expect(run.gcloud).toEqual([]);
  });

  it("refuses --write outside sql", async () => {
    const run = await runAgent(["logs", "api", "--write"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("--write is only valid for sql");
    expect(run.stderr).toContain("Usage:");
    expect(run.gcloud).toEqual([]);
  });

  it("refuses a non-numeric --tail", async () => {
    const run = await runAgent(["logs", "api", "--tail", "lots"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("--tail requires");
    expect(run.stderr).toContain("Usage:");
    expect(run.gcloud).toEqual([]);
  });
});
