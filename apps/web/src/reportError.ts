import * as Sentry from "@sentry/react";

// Reports a caught error to Sentry and returns a user-facing message for it.
// Centralized so application-caught errors (e.g. a failed data fetch) reach
// Sentry instead of being silently swallowed by local UI state handling.
export function reportError(error: unknown): string {
  Sentry.captureException(error);
  return error instanceof Error ? error.message : String(error);
}
