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
  errors reach the error boundary and the report. A deliberate fail-open path
  uses `reportErrorQuietly`, which records the error without a UI message.
  Both share the rule that an expected client outcome (`ApiError` under 500,
  `SessionExpiredError`) is not reported.
- ESLint's `no-console` rule fails a web production source that logs directly,
  so a caught failure cannot bypass Sentry. `ErrorBoundary.tsx` keeps its
  development log, and `main.tsx` may call `console.warn` beside its own root
  error hooks.
- The web bundle's source maps are uploaded by `@sentry/vite-plugin` inside the
  deploy's web build, to the release named by `DEPLOY_SHA`. Three rules keep a
  minified stack from reaching the issue stream:
  - The upload must fail the build. The plugin deletes the maps from `dist`
    after the upload and logs a failed one without failing the build, so an
    expired token would otherwise publish a bundle Sentry can never
    symbolicate; `vite.config.ts` passes an `errorHandler` that rethrows.
  - The `sentry` CLI is overridden to 0.50.0 or later in the root
    `package.json`. The plugin uploads by debug ID and lets the CLI re-inject
    the registration, but Vite 8's minifier writes that registration with
    template literals, which CLI 0.49 did not recognise: it prepended a second
    snippet and an empty mapping line, so the uploaded map described a file one
    line longer than the deployed bundle and every frame resolved one line off.
    The override can go once `@sentry/vite-plugin` allows 0.50.0 itself;
    `scripts/sentryCli.test.ts` fails if the resolved CLI drops below it. See
    getsentry/toolkit#2248.
  - The deploy build emits hidden maps: the published JS carries no
    `sourceMappingURL` for a map that is not published beside it, and
    `sourcemaps.deleteSourcemapsAfterUpload` removes the maps from `dist` once
    they are uploaded.
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
- A web production source cannot call `console` directly except the documented
  `ErrorBoundary.tsx` and `main.tsx` warnings.
- A web source-map upload that fails fails the deploy build, and the resolved
  `sentry` CLI recognises the debug ID registration Vite 8 emits, so a deployed
  bundle's frames resolve to source lines.
- A release names the commit that CI tested and deployed.
- `bun run typecheck`, `bun run lint`, `bun run format` and `bun run test` pass.
