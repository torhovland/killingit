import type { Hono } from "hono";
import { sentry } from "@sentry/hono/bun";

// The Sentry DSN. Configured per environment via SENTRY_DSN. When absent (e.g.
// local development without .env.local or the unit-test suite), Sentry is
// disabled and the app is returned untouched so nothing reaches Sentry ingest.
const dsn = process.env.SENTRY_DSN;

const environment = process.env.NODE_ENV ?? "development";
const release = process.env.SENTRY_RELEASE;

export function withSentry(app: Hono): Hono {
  if (!dsn) {
    return app;
  }

  // The Sentry Hono middleware initializes Sentry, continues incoming
  // distributed traces (sentry-trace / baggage headers from the web app), and
  // captures unhandled request errors.
  app.use(
    sentry(app, {
      dsn,
      environment,
      ...(release ? { release } : {}),
      tracesSampleRate: 1.0,
    }),
  );

  return app;
}
