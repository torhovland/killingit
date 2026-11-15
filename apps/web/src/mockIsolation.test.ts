import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SOURCE_DIR = import.meta.dir;

/** A suite that replaces the auth barrel with a process-global mock. */
const AUTH_BARREL_MOCK = /mock\.module\(\s*["'`](?:\.\.?\/auth)["'`]/;

/**
 * The restore inside an `afterAll` callback. Bun's `mock.restore()` clears
 * every module mock in the process, so a suite that never calls it leaves the
 * fake barrel behind for whichever suite loads next.
 */
const RESTORES_MOCKS =
  /afterAll\(\s*(?:async\s*)?\(\)\s*=>\s*\{[\s\S]*?mock\.restore\(\)/;

/** Every test file under the web source tree. */
function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return testFiles(path);
    }
    return entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

const TEST_SOURCES = testFiles(SOURCE_DIR).map((file) => ({
  file: relative(SOURCE_DIR, file),
  text: readFileSync(file, "utf8"),
}));

const AUTH_BARREL_MOCKS = TEST_SOURCES.filter(({ text }) =>
  AUTH_BARREL_MOCK.test(text),
);

/**
 * The auth barrel owns the only stateful module mock in the web suite, so this
 * guard covers it alone. Issue #488 broadens the check to every `mock.module`
 * suite once those restore their mocks too.
 */
describe("module mock isolation", () => {
  it("finds the suites that mock the auth barrel", () => {
    expect(AUTH_BARREL_MOCKS.length).toBeGreaterThan(0);
  });

  it("restores every auth-barrel mock when its suite ends", () => {
    const offenders = AUTH_BARREL_MOCKS.filter(
      ({ text }) => !RESTORES_MOCKS.test(text),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
