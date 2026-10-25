import { MissingRefreshTokenError } from "@auth0/auth0-react";

/**
 * Raised when the stored session can never be renewed: its refresh token is
 * gone (never issued, revoked, rotated out by reuse detection, or expired) and
 * the silent-iframe fallback could not restore one.
 *
 * This is an expected outcome of a long-lived page, not a bug, so callers show
 * it as "sign in again" and `reportError` keeps it out of Sentry.
 */
export class SessionExpiredError extends Error {
  constructor(cause?: unknown) {
    super("Your session has expired. Sign in again to continue.", { cause });
    this.name = "SessionExpiredError";
  }
}

/**
 * Whether a failed token renewal means the cached session is dead instead of
 * temporarily broken (network error, Auth0 outage). Only the former justifies
 * dropping the cache; a transient failure must keep the session so the next
 * request can succeed.
 */
export function isUnrecoverableSessionError(error: unknown): boolean {
  if (error instanceof MissingRefreshTokenError) {
    return true;
  }
  // Errors from the token endpoint and from the silent-iframe `/authorize`
  // request both carry the OAuth error code in `error`.
  const code = (error as { error?: unknown } | null | undefined)?.error;
  return (
    code === "login_required" ||
    code === "consent_required" ||
    code === "invalid_grant"
  );
}
