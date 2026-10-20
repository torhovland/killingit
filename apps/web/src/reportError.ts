import * as Sentry from "@sentry/react";
import { ApiError } from "./fetchJson";

// Reports a caught error to Sentry and returns a user-facing message for it.
// Centralized so application-caught errors (e.g. a failed data fetch) reach
// Sentry instead of being silently swallowed by local UI state handling.
export function reportError(error: unknown): string {
  // 4xx responses are expected outcomes of user actions (bad credentials, MFA
  // required, Garmin rate limiting, an expired session), so capturing them
  // would only add noise. 5xx responses and unexpected errors are reported.
  const expected = error instanceof ApiError && error.status < 500;
  if (!expected) {
    Sentry.captureException(error);
  }
  return error instanceof Error ? error.message : String(error);
}
