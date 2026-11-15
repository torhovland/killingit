import { describe, expect, it } from "bun:test";

/**
 * The barrel re-exports the Auth0 adapter and the session error, and every page
 * imports the barrel rather than the adapter. Other suites replace it with a
 * process-global mock, so the real module is imported through a query-string
 * specifier here: Bun evaluates that specifier separately and attributes it to
 * `index.ts`, keeping the file in the coverage denominator whatever test loads
 * first.
 */
const barrelSpecifier = "./index.ts?real";
const barrel = (await import(barrelSpecifier)) as typeof import("./index.js");

describe("auth barrel", () => {
  it("exports the session hook and the expired-session error", () => {
    expect(typeof barrel.useAuth).toBe("function");
    expect(new barrel.SessionExpiredError()).toBeInstanceOf(Error);
    expect(new barrel.SessionExpiredError().message).toBe(
      "Your session has expired. Sign in again to continue.",
    );
  });
});
