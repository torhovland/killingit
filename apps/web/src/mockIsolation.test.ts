import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SOURCE_DIR = import.meta.dir;

/** A suite that replaces a module with a process-global mock. */
const MODULE_MOCK = /mock\.module\s*\(/;

/**
 * The restore inside an `afterAll` callback. Bun's `mock.restore()` clears
 * every module mock in the process, so a suite that never calls it leaves the
 * fake behind for whichever suite loads next.
 */
const RESTORES_MOCKS =
  /afterAll\(\s*(?:async\s*)?\(\)\s*=>\s*\{[\s\S]*?mock\.restore\(\)/;

/**
 * A `useAuth` mock that builds a new session object on every call. The real
 * hook promises a stable identity, and `useApiResource` lists `auth` in an
 * effect dependency, so an unstable fake aborts and refetches on every render
 * and times out under load.
 */
const UNSTABLE_AUTH_MOCK = /useAuth\s*:\s*\(\)\s*=>\s*\(\s*\{/;

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

const TEST_SOURCES = testFiles(SOURCE_DIR)
  .filter((file) => file !== import.meta.path)
  .map((file) => ({
    file: relative(SOURCE_DIR, file),
    text: readFileSync(file, "utf8"),
  }));

const MODULE_MOCKS = TEST_SOURCES.filter(({ text }) => MODULE_MOCK.test(text));

describe("module mock isolation", () => {
  it("finds the suites that mock a module", () => {
    expect(MODULE_MOCKS.length).toBeGreaterThan(0);
  });

  it("restores every module mock when its suite ends", () => {
    const offenders = MODULE_MOCKS.filter(
      ({ text }) => !RESTORES_MOCKS.test(text),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("returns a stable auth session from every useAuth mock", () => {
    const offenders = MODULE_MOCKS.filter(({ text }) =>
      UNSTABLE_AUTH_MOCK.test(text),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
