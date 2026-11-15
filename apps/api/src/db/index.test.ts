import { describe, expect, it } from "bun:test";

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
