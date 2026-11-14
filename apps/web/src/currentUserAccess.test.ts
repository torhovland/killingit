import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SOURCE_DIR = import.meta.dir;

/**
 * The modules allowed to name `/api/me`. The provider reads and patches the
 * account, and account deletion ends it; any other caller is a page loading or
 * writing the current user of its own, which is what this guard prevents.
 */
const ALLOWED = new Set([
  "CurrentUserProvider.tsx",
  "settings/DeleteAccountSection.tsx",
]);

/** The account route in a string literal, template or query-bearing path. */
const ACCOUNT_ROUTE = /\/api\/me(?=["'`?])/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
      ? [path]
      : [];
  });
}

describe("current-user access", () => {
  it("names /api/me only in the provider and account deletion", () => {
    const offenders = sourceFiles(SOURCE_DIR)
      .filter(
        (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
      )
      .filter((file) => ACCOUNT_ROUTE.test(readFileSync(file, "utf8")))
      .map((file) => relative(SOURCE_DIR, file))
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });
});
