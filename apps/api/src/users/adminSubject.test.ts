import { describe, expect, it } from "bun:test";
import { configuredAdminSubject } from "./adminSubject.js";

describe("configuredAdminSubject", () => {
  it("returns the configured auth subject", () => {
    expect(configuredAdminSubject({ ADMIN_AUTH_SUBJECT: "auth0|owner" })).toBe(
      "auth0|owner",
    );
  });

  it("treats an unset value as no administrator", () => {
    expect(configuredAdminSubject({})).toBeNull();
  });

  it("treats a blank value as no administrator", () => {
    expect(configuredAdminSubject({ ADMIN_AUTH_SUBJECT: "   " })).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(
      configuredAdminSubject({ ADMIN_AUTH_SUBJECT: " auth0|owner\n" }),
    ).toBe("auth0|owner");
  });
});
