import { describe, expect, it } from "bun:test";
import { MissingRefreshTokenError } from "@auth0/auth0-react";
import { isUnrecoverableSessionError, SessionExpiredError } from "./session";

describe("isUnrecoverableSessionError", () => {
  it("recognizes a missing refresh token", () => {
    const error = new MissingRefreshTokenError(
      "https://api.example.com",
      "openid offline_access",
    );

    expect(isUnrecoverableSessionError(error)).toBe(true);
  });

  it("recognizes OAuth errors that mean the session cannot be renewed", () => {
    for (const code of [
      "login_required",
      "consent_required",
      "invalid_grant",
    ]) {
      expect(isUnrecoverableSessionError({ error: code })).toBe(true);
    }
  });

  it("treats transient failures as recoverable", () => {
    // Network timeouts and Auth0 outages must not drop a healthy session.
    expect(isUnrecoverableSessionError(new Error("network down"))).toBe(false);
    expect(isUnrecoverableSessionError({ error: "timeout" })).toBe(false);
    expect(isUnrecoverableSessionError(null)).toBe(false);
    expect(isUnrecoverableSessionError("nope")).toBe(false);
  });
});

describe("SessionExpiredError", () => {
  it("tells the athlete to sign in again", () => {
    const cause = new Error("Missing Refresh Token");
    const error = new SessionExpiredError(cause);

    expect(error.message).toBe(
      "Your session has expired. Sign in again to continue.",
    );
    expect(error.cause).toBe(cause);
  });
});
