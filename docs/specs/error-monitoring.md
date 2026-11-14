# Spec: Error monitoring

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** `docs/specs/api-logging.md`, `docs/specs/api-server-entry.md`,
  `docs/specs/deploy-workflow.md`, `docs/specs/third-party-notices.md`

## Goal

Make an uncaught failure visible to the maintainer with the release that
produced it, without adding a paid operational dependency.

## Decision

Use **Sentry.io** on the free **Developer** plan: 5,000 errors/month, 5M spans,
50 session replays, 1 seat and 30-day retention. That is sufficient to start;
the Team plan is the upgrade path if the volume outgrows it.

## Scope

- The API initialises Sentry in `withSentry`, the middleware that wraps the
  Hono app. A missing `SENTRY_DSN` leaves the app untouched, so local and test
  runs never send events. A thrown request failure is captured once, alongside
  its JSON request line; see `docs/specs/api-logging.md`.
- A web error is sent through `reportError` (`apps/web/src/reportError.ts`),
  and Sentry is initialised first in `apps/web/src/main.tsx` so uncaught render
  errors reach the error boundary and the report.
- The deploy workflow tags a release with `DEPLOY_SHA`, so the built tree, the
  pushed image and the release it reports cannot name different commits; see
  `docs/specs/deploy-workflow.md`.
- Sentry's licence and packages are part of the third-party notices; see
  `docs/specs/third-party-notices.md`.

## Acceptance criteria

- The API and web app initialise Sentry only when a DSN is configured, and a
  missing DSN is a no-op rather than a startup failure.
- An API failure that throws out of a handler is captured once, not printed a
  second time as plain text.
- A release names the commit that CI tested and deployed.
- `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test` pass.
