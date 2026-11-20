import { describe, expect, it } from "bun:test";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

/**
 * The Sentry CLI version the web build's source-map upload needs.
 *
 * `@sentry/vite-plugin` uploads by debug ID: it injects a debug ID snippet, and
 * the CLI then re-injects when it does not recognise the existing registration.
 * Vite 8's minifier writes the registration's string literals as template
 * literals, which the 0.49 CLI only matched when quoted with `'` or `"`, so it
 * prepended a second snippet and added an empty mapping line. The uploaded map
 * then described a file one line longer than the deployed bundle, and Sentry
 * resolved every frame one line off (minified frames, no usable symbolication).
 * 0.50.0 recognises the template-literal form and skips the file.
 *
 * See `docs/specs/error-monitoring.md` and getsentry/toolkit#2248. The root
 * `overrides` entry can go once `@sentry/vite-plugin` allows 0.50.0 itself.
 */
const MINIMUM_CLI_VERSION = [0, 50, 0] as const;

const PACKAGE_JSON = JSON.parse(
  await Bun.file(path.join(REPO_ROOT, "package.json")).text(),
) as { overrides?: Record<string, string> };

const LOCKFILE = await Bun.file(path.join(REPO_ROOT, "bun.lock")).text();

/** The `sentry` CLI version the lockfile installs. */
function resolvedCliVersion(): string {
  const match = LOCKFILE.match(/^\s*"sentry": \["sentry@(\d+\.\d+\.\d+)"/m);
  if (match?.[1] === undefined) {
    throw new Error("bun.lock does not resolve the Sentry CLI");
  }
  return match[1];
}

/** Whether a `major.minor.patch` version is at least the given floor. */
function atLeast(version: string, floor: readonly number[]): boolean {
  const parts = version.split(".").map(Number);
  for (const [index, minimum] of floor.entries()) {
    const part = parts[index] ?? 0;
    if (part !== minimum) {
      return part > minimum;
    }
  }
  return true;
}

describe("Sentry CLI version", () => {
  it("is overridden in the root package", () => {
    // The plugin declares `sentry: ^0.49.0`, which cannot resolve 0.50.0, so
    // the fixed CLI only arrives through this override.
    expect(PACKAGE_JSON.overrides?.sentry).toMatch(/^[\^~]?\d+\.\d+\.\d+$/);
    expect(
      atLeast(
        (PACKAGE_JSON.overrides?.sentry ?? "").replace(/^[\^~]/, ""),
        MINIMUM_CLI_VERSION,
      ),
    ).toBe(true);
  });

  it("resolves at or above the release that recognises the debug ID Vite 8 emits", () => {
    expect(atLeast(resolvedCliVersion(), MINIMUM_CLI_VERSION)).toBe(true);
  });
});
