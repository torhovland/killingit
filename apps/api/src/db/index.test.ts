import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** A module-local declaration of a type that `db/index.ts` exports for reuse. */
const LOCAL_EXECUTOR_TYPE = /^(?:export )?type (?:DbExecutor|DbTransaction)\b/m;

const SRC = path.join(import.meta.dir, "..");

/** Every non-test module under `apps/api/src`. */
function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionFiles(file);
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [file];
  });
}

describe("database executor types", () => {
  it("declares them only in db/index.ts", () => {
    // The type of the shared connection and of one transaction on it is derived
    // from the Drizzle client once, so every store accepts the same executor
    // and a change to the client cannot leave one module behind.
    const declarations = productionFiles(SRC)
      .flatMap((file) =>
        LOCAL_EXECUTOR_TYPE.test(readFileSync(file, "utf8"))
          ? [path.relative(SRC, file)]
          : [],
      )
      .sort();
    expect(declarations).toEqual(["db/index.ts"]);
  });
});

describe("database module", () => {
  it("refuses to load without DATABASE_URL outside development and tests", () => {
    // A deploy that forgets DATABASE_URL must fail at startup with a message
    // that names it, not fall back to the local docker-compose database and
    // fail on the first query instead.
    const moduleUrl = new URL("./index.ts", import.meta.url).href;
    const script = `await import(${JSON.stringify(moduleUrl)})`;
    const result = Bun.spawnSync({
      cmd: [process.execPath, "--eval", script],
      cwd: import.meta.dir,
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      'DATABASE_URL is required when NODE_ENV is "production"',
    );
    expect(result.stdout.toString()).not.toContain("postgres://");
    expect(result.stderr.toString()).not.toContain("postgres://");
  });
});
