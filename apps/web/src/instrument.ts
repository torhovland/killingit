import * as Sentry from "@sentry/react";

// Browser DSN for the React (Vite) app. Sentry is inert when this is unset
// (local dev without a DSN); the Vite build injects it from VITE_SENTRY_DSN.
const dsn = import.meta.env.VITE_SENTRY_DSN;

// The absolute API origin, when the app is served from a different host than
// the API (production). Empty means the API is same-origin (local dev proxy).
const apiUrl = import.meta.env.VITE_API_URL;

// Release identifier, set from github.sha in CI so runtime events and uploaded
// source maps resolve to the same release.
const release = import.meta.env.VITE_SENTRY_RELEASE;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    ...(release ? { release } : {}),
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 1.0,
    // Propagate trace headers to same-origin requests plus the API origin, so
    // backend spans link back to the browser trace (distributed tracing).
    tracePropagationTargets: [
      "localhost",
      /^\/api\//,
      ...(apiUrl
        ? [new RegExp(`^${apiUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)]
        : []),
    ],
  });
}
