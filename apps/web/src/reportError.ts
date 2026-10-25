import * as Sentry from "@sentry/react";
import { SessionExpiredError } from "./auth";
import { ApiError } from "./fetchJson";

// Reports a caught error to Sentry and returns a user-facing message for it.
// Centralized so application-caught errors (e.g. a failed data fetch) reach
// Sentry instead of being silently swallowed by local UI state handling.
export function reportError(error: unknown): string {
  // Expected outcomes of user actions (bad credentials, a rate-limited
  // provider, an expired session the user must re-create) are not reported;
  // 5xx responses and unexpected errors are.
  const expected =
    (error instanceof ApiError && error.status < 500) ||
    error instanceof SessionExpiredError;
  if (!expected) {
    Sentry.captureException(error);
  }
  return error instanceof Error ? error.message : String(error);
}
