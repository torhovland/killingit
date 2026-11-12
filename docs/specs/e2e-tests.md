# Spec: End-to-end tests

- **Status:** Accepted (implemented)
- **Date:** 2026-11-11
- **Related:** `AGENTS.md` (Development Methodology), issue #165,
  `docs/specs/database-integration-tests.md`,
  `docs/specs/auth-integration.md`, `docs/specs/diet-log.md`,
  `docs/specs/account-deletion.md`.

## Goal

Exercise the critical browser journeys against the real web app, API, database
schema and migrations. The unit and route tests cover behaviour in isolation;
this suite covers the parts only a real browser reaches: the signed-out landing
page, the sign-in hand-off, the dashboard cross-page state, the survey gate, a
background-free coach reply, a meal photo upload with its analysis, page URLs
across a deep link, reload and the history buttons, the modal focus trap and
focus restore, and account deletion with sign-out.

## Scope

### In scope

1. Playwright (`@playwright/test`) with a small, serial suite of ten journeys:
   - a signed-out visitor sees the landing page and signs in to the dashboard;
   - a page keeps its URL across a reload, back and forward;
   - a deep link opens its page after signing in;
   - an unknown path lands on the coach page;
   - an athlete answers the coaching survey and reaches today's session;
   - an athlete saves a weekly note and sees the coach reply;
   - an athlete logs a meal with a photo and sees the analysis;
   - a keyboard user closes the calendar workout dialog with Escape and gets
     focus back on the entry that opened it;
   - a keyboard user cannot Tab out of the delete dialog, closes it with
     Escape, and gets focus back on the trigger;
   - an athlete deletes the account and lands back on the sign-in page.
2. A dedicated API process for the suite that uses the production
   `createApp` wiring with a fixed test identity, a stub LLM provider, and
   no-op plan generation. It runs against a migrated, seeded test database.
3. A dedicated Vite configuration that replaces only the web auth adapter with
   a browser-local fake session. The rest of the app is the production code.
4. A CI job that starts PostgreSQL and runs the suite with Chromium. The suite
   is also runnable locally and is a required pre-release check.

### Out of scope

- Garmin, OpenRouter or Auth0 network calls. The suite never contacts them.
- Plan generation, activity analysis and weather. Those are covered by route
  and unit tests; the e2e suite asserts the stored-plan UI instead.
- Service-worker offline behaviour. The PWA has its own unit coverage.
- Mobile device projects. One Chromium project keeps the suite fast.

## Behaviour

### Test database

- The API and the tests use `E2E_DATABASE_URL` when set, otherwise
  `postgres://killingit:killingit@localhost:5432/killingit_e2e_test`.
- The database name must end in `_test`; the suite refuses to start otherwise.
- The API process drops the `public` and `drizzle` schemas, applies every
  migration, and then serves requests. Each test truncates every table and
  seeds only the rows that journey needs.
- Seed helpers live in `apps/api/e2e/seed.ts` and use the production stores and
  fixtures, so the data matches the shared schemas.

### Auth

- The web build under `apps/web/vite.e2e.config.ts` resolves
  `apps/web/src/auth/auth0.ts` to `apps/web/e2e/e2eAuth.ts`. That adapter
  stores a local session flag and returns a fixed bearer token. The landing
  page, `useAuth` consumers, sign-out and account deletion are unchanged.
- The API process accepts only that fixed token through a test
  `AuthProvider`. Any other token is rejected as a normal auth failure.

### Coach and integrations

- A stub `LlmProvider` answers a coach reply with fixed text and a food prompt
  with fixed JSON macros. It is wired through the existing `loadLlm`
  dependency.
- Plan generation, background activity-comment replies and Garmin sync are
  replaced with no-op dependencies, so a test never waits for background coach
  work. The weekly-note reply is generated inline through the stub provider.
  The stored plan is the shared integration fixture, viewed through the
  existing development date override (`VITE_APP_ENV` Development).
- `llm_model_sync.lastCheckedAt` is seeded so the page-visit catalog refresh is
  a no-op and the suite never calls OpenRouter.

### CI

A `e2e` job in `.github/workflows/ci.yml` starts the `postgres:16-alpine`
service and runs `bun run test:e2e` inside the official Playwright container
image (`mcr.microsoft.com/playwright:v<version>-noble`). The image carries
Chromium and its system libraries, so the job never installs packages from the
Ubuntu archives; the tag must match the `@playwright/test` version in
`bun.lock`. The image does not include Bun or `unzip`, so the job downloads the
pinned Bun release and extracts it with Python. Playwright starts the API and
web dev servers through its `webServer` config, and reaches PostgreSQL by the
service label `postgres` with `sslmode=disable` so the local service is not
mistaken for a hosted database that needs TLS.

## Data-model and API impact

None. The suite only uses existing tables, stores, routes and fixtures. No
production code path changes: the fake auth adapter is selected by a separate
Vite config, and the API test identity is passed through the existing
`AppDependencies.authProvider` seam.

## Acceptance criteria

- `bun run test:e2e` passes against a running docker-compose PostgreSQL after
  `bun run db:up`.
- A failure in any journey fails the run, and the run leaves no state for the
  next test by truncating and reseeding.
- The suite refuses to run against a database whose name does not end in
  `_test`.
- CI runs the suite in its own job alongside typecheck, lint, format, unit and
  integration tests.
- `bun run test` remains database-free and does not run the e2e suite.
