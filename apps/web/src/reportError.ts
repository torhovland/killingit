import * as Sentry from "@sentry/react";
import { SessionExpiredError } from "./auth";
import { ApiError } from "./fetchJson";

// Expected outcomes of user actions (bad credentials, a rate-limited provider,
// an expired session the user must re-create) are not reported; 5xx responses
// and unexpected errors are.
function isExpected(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.status < 500) ||
    error instanceof SessionExpiredError
  );
}

// Reports a caught error to Sentry and returns a user-facing message for it.
// Centralized so application-caught errors (e.g. a failed data fetch) reach
// Sentry instead of being silently swallowed by local UI state handling.
export function reportError(error: unknown): string {
  if (!isExpected(error)) {
    Sentry.captureException(error);
  }
  return error instanceof Error ? error.message : String(error);
}

// Reports a caught error to Sentry without returning a message. A deliberate
// fail-open path uses this so the page keeps working, but the failure still
// reaches Sentry under the same expected-versus-unexpected rule as
// `reportError`.
export function reportErrorQuietly(error: unknown): void {
  if (!isExpected(error)) {
    Sentry.captureException(error);
  }
}
