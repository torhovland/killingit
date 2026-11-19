import * as Sentry from "@sentry/bun";

/**
 * Reports a failure that ended a background run to Sentry. The Hono middleware
 * in `instrumentation/sentry.ts` binds a client only when `SENTRY_DSN` is set,
 * so unit tests and local development without a DSN drop the event instead of
 * queueing it. See `docs/specs/plan-run-resilience.md`.
 */
export function reportError(error: unknown): void {
  if (Sentry.getClient() === undefined) {
    return;
  }
  Sentry.captureException(error);
}
