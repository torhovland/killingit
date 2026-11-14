# AGENTS.md

This is the working guide for an AI coding agent: the rules you must follow, the
stack and layout you work in, and the commands to run. Feature detail lives in
`docs/specs/` (indexed below); a spec is the source of truth for its behaviour.

## Project Overview

An **AI coach app** that turns the athlete's workouts into a dynamic training
program.

- It coaches **amateur athletes**; the onboarding input (goals, age, location,
  training time, current performance) forms the **athlete profile**.
- It connects training data from **Garmin**; **Strava** and **Wahoo** are
  **planned**.
- An **LLM** plans the season, the current **training block** (a season segment
  of weeks with a given focus), the week and today, using weather and daylight
  at the athlete's location.
- On each visit the athlete sees a **suggested workout (or rest) for today**,
  possibly with alternatives, plus coach analysis, and can steer the coach;
  revising the input regenerates the affected plans.

The project is in active development: investigate unfamiliar files before
modifying or deleting them; they may be someone's work in progress.

## Stack

One TypeScript stack end-to-end; see `docs/adrs/` for decisions, and **planned**
marks anything not yet built.

**Frontend.** React and TypeScript on Vite, styled with Tailwind CSS v4 and
design tokens in `apps/web/src/index.css`. Compose a primitive's `variant`/`size`
before `className`, merge classes with `cn()`, never repeat a primitive's base
string in a page, and avoid inline styles and hard-coded colours; the component
library is in `apps/web/src/components/` (`Modal` owns every dialog), and each
page lives in its feature directory (`calendar/`, `fitness/`, `diet/`,
`settings/`, `admin/`) beside its tests. See
`docs/specs/web-component-library.md` and `docs/specs/modal-dialog.md`.

The app is an installable **PWA**; every page has a canonical URL and every
request carries the API contract version. API reads use `requestParsed` and
`useApiResource`, paths resolve through `apps/web/src/apiUrl.ts`, and form values
from the server use `usePropDraft`. Hooks and JSX are linted (`react-hooks`,
`jsx-a11y`), and charts are keyboard reachable and draw through `chartPath`. See
`docs/specs/pwa.md`, `docs/specs/web-api-request-parsing.md`,
`docs/specs/web-api-resource-hook.md` and
`docs/specs/chart-keyboard-navigation.md`.

**Backend.** TypeScript on Bun, Hono for the API, Drizzle ORM and Zod. Shared Zod
schemas are validated on both sides (API `zValidator`, web responses);
`packages/shared` holds the wire contract and API-only logic lives in `apps/api`.
Failures use `{ error: { code, message, details? } }` from
`packages/shared/src/apiError.ts`, and `apps/api/src/index.ts` exports the
side-effect-free `createApp` that `server.ts` runs. See
`docs/specs/shared-api-boundary.md`, `docs/specs/api-errors.md` and
`docs/specs/api-server-entry.md`.

Bun workspaces: `apps/web`, `apps/api`, `packages/shared` (ADR 0055) and
`tools/benchmark` (ADR 0032); `scripts/` is not a workspace but is typechecked by
`tsconfig.scripts.json` (ADR 0054). PostgreSQL runs on Neon and in Docker locally
(`bun run db:generate`, `bun run db:migrate`); the API is on Cloud Run, the web on
Cloudflare Pages, and GitHub Actions deploys on `main` with manual approval for
production (ADR 0001 and the `README.md` runbook).

**Auth.** Sign-in runs through Auth0; Google and Apple are the standard social
IdPs, and **Garmin and Strava are planned** as custom OAuth 2.0 connections (ADR
0002). Roles live in `users`: only the account whose auth subject matches
`ADMIN_AUTH_SUBJECT` is admin (never implicit, none when unset), and only the
admin manages athlete questions (ADR 0006, `docs/specs/admin-settings.md`).
Authentication is default-on for `/api/*`: `requireAuth` runs once on the
namespace and only `PUBLIC_API_PATHS` are public, `requireUser` provisions the
account, and `requireAdmin()` returns 403 for a member. See
`docs/specs/authenticated-user-middleware.md`, ADR 0024 and ADR 0026.

**Monitoring and weather.** Sentry.io on the free Developer plan reports errors
(see `docs/specs/error-monitoring.md`). Open-Meteo and Yr.no provide the weather
and daylight behind a small provider interface, and OpenStreetMap's Nominatim
geocoder and tiles handle address search and maps; see
`docs/specs/location-and-weather.md`, ADR 0008, ADR 0010 and ADR 0017.

## Commands

Run from the root; `bun run db:up` starts local PostgreSQL and `bun run dev` runs
the web app, API and Garmin sidecar after migrating.

| Command                    | What it does                                          |
| -------------------------- | ----------------------------------------------------- |
| `bun run typecheck`        | TypeScript for every project and `scripts/`           |
| `bun run test`             | Unit tests, including `scripts/` and its guard tests  |
| `bun run lint` / `format`  | ESLint and Prettier (`lint:fix` / `format:fix` write) |
| `bun run check:unused`     | Knip production export and file scan                  |
| `bun run check:garmin`     | pytest, ruff and mypy for the Garmin sidecar          |
| `bun run test:integration` | Database-backed API tests                             |
| `bun run test:e2e`         | Playwright journeys                                   |
| `bun run test:coverage`    | Coverage against each package's baseline              |
| `bun run outdated`         | Report outdated dependencies                          |
| `bun run benchmark:llm`    | Model comparison harness (`benchmark:prompts` too)    |

## Observability and agent access

- The API writes one JSON request line to standard output with severity, time,
  event, request id, method, path, status, duration and the error on a throw; 4xx
  is a warning and 5xx an error. An incoming `x-request-id` is reused when
  header-safe and echoed; query, headers and body are never logged. See
  `docs/specs/api-logging.md` and ADR 0033.
- The database and application logs are **accessible to the coding agent**
  through `scripts/agent.sh`. It reads the API or Garmin sidecar logs and runs SQL
  against the test database read-only by default; `--env prod` selects production
  and `--write` is the maintainer's explicit opt-in to a read-write session. Filter
  the JSON request lines with `jq`. See `docs/specs/agent-access-script.md`.

## Development Methodology

The agent does the coding, but we minimize AI "slop" and unmaintainable code
through a disciplined process:

1. **Spec before code.** For anything non-trivial, write a short spec first:
   goal, scope, acceptance criteria, and data-model/API impact; implement against
   the spec, not a vague prompt.
2. **Test-driven development.** Write failing tests, then implement to make them
   pass. New behaviour always comes with tests.
3. **Small, reviewable units of work.** One logical change per task/commit/PR;
   keep diffs small and to a single concern.
4. **Human review gate.** The agent proposes; a human verifies before merge.
5. **Static quality everywhere.** TypeScript `strict` (plus the extra flags in
   `tsconfig.base.json`), ESLint, Prettier and the unused-export scan pass in CI
   (`bun run typecheck`, `bun run lint`, `bun run format`,
   `bun run check:unused`). Every TypeScript file belongs to one named project —
   each package has its `tsconfig.json` and the root `tsconfig.scripts.json` owns
   `scripts/` — and a guard test fails on a new root-level tree. See
   `docs/specs/typescript-project-coverage.md` and ADR 0054.
6. **Full test coverage on every feature**, across every layer: unit tests with
   `bun:test`; the Garmin sidecar's pytest/ruff/mypy suite via
   `bun run check:garmin`, which also pins its wire contract from both languages
   (see `docs/specs/garmin-sidecar-checks.md` and
   `docs/specs/garmin-sidecar-contract.md`); database integration tests via
   `bun run test:integration` (see `docs/specs/database-integration-tests.md`);
   Playwright end-to-end journeys via `bun run test:e2e` (see
   `docs/specs/e2e-tests.md`); and per-package coverage baselines via
   `bun run test:coverage` (see `docs/specs/test-coverage.md`).
7. **CI pipeline** (`.github/workflows/ci.yml`): typecheck, lint, format, unused
   exports, unit, integration and e2e tests, the sidecar's Python checks, the
   contribution sign-off check, and the `build` job (real `vite build` plus both
   Docker images, so a broken bundle or Dockerfile fails CI); see
   `docs/specs/ci-build-job.md`.
8. **Dependencies stay current.** CI fails the pull request when any dependency
   is outdated (`bun run outdated`), so the update is made inside the ordinary
   pull request that is open when the release appears. Update with `bun update`
   (`--latest` for a major jump), verify typecheck/lint/format/tests, and commit
   `bun.lock` (and any `package.json` change) separately.
9. **Decoupled, clearly named code.** Single-responsibility modules, explicit
   dependencies, descriptive names; don't over-abstract, but extract real
   duplication.
10. **Documents stay current.** Keep AGENTS.md accurate and write ADRs for
    significant choices. `scripts/docs.test.ts` fails on a missing referenced
    spec, ADR or benchmark file, a duplicate ADR number, a foreign unit-test
    runner, or a spec missing from the index below.
11. **Definition of done.** Tests, types, lint and the unused-export check pass,
    including `bun run check:garmin` when the sidecar or its tooling changes.
12. **Clean, readable code first.** Readability matters as much as working
    features; if a small feature needs many new lines, it is probably not worth
    it.
13. **Strict review.** Be strict and thorough; nitpicking is encouraged. Comment
    on the PR unless everything looks good.
14. **Implementation ends in a pull request.** Finish every implementation by
    pushing and opening a PR, not a local edit.

## Licensing

- The repository is **source-available, not open source**: PolyForm
  Noncommercial 1.0.0. Commercial use is forbidden, personal, hobby, study and
  non-commercial-organization use is allowed, and the licence is non-exclusive
  so the commercial licence, relicensing and assignment stay available. See
  `docs/adrs/0022-source-available-noncommercial-license.md`.
- Never describe the project as open source, and never add a second licence, an
  `SPDX-License-Identifier` header with other terms, or a permissive notice to
  new files. `LICENSE.md` covers every file in the repository.
- Keep the `Required Notice: Copyright (c) 2026 Tor Hovland` line intact. It is
  the attribution duty the licence enforces, and it must travel with every
  distribution.
- Contributions require the copyright assignment described in
  `CONTRIBUTING.md` before they are merged; without it the project can no
  longer be relicensed or sold.

## Working side effects

- **Verify CI before pushing.** When asked to push changes, first run
  `bun run typecheck`, `bun run lint`, `bun run format`, `bun run check:unused`,
  `bun run test` and `bun run check:garmin` locally (or verify the equivalent
  CI checks pass), and confirm they all succeed before pushing.
- **Make sure CI passes on PRs.** When asked to create or update a PR, make
  sure CI passes.

## Development Guidelines

- Keep changes consistent with the surrounding structure, naming, style and
  patterns, and treat unfamiliar files as potential user work: investigate before
  overwriting or deleting them.
- **Never duplicate prompt fragments across prompts.** Put every reusable prompt
  fragment — a persona, rule, JSON contract, output instruction, response sentence
  or key list — in `apps/api/src/llm/promptRules.ts`, and compose every prompt from
  those exports. Every prompt starts with `GLOBAL_PROMPT_RULES`, and fragments
  every plan prompt uses are merged into `PLAN_PROMPT_RULES`. Extend that module
  rather than adding a second copy: a duplicated fragment is a bug waiting to
  diverge.
- **Never leave production exports alive only for their tests.** Delete dead
  code or wire it to a real caller. `bun run check:unused` runs Knip in production
  mode and fails on an export referenced only inside its own module, a test-only
  export, an unused `@killingit/shared` barrel export, and an unreachable
  production file. Un-export a module-local helper rather than exporting it for
  its test, and rewrite the test against the production consumer; list intentional
  public API in `knip.json` with a comment. See `docs/specs/unused-exports.md`.
- **Wire API dependencies through the shared context.** The injectable surface
  lives in `apps/api/src/dependencies.ts`; `createApp` resolves the account
  stores once and passes `ResolvedAppDependencies` to the factories, with their
  own `??` defaults. Do not conditionally spread a field — type it `T | undefined`
  and forward it. A plan run's loaders and writers are `PlanTriggerDependencies`
  fields; enrichment inputs are fail-open, while the account state and activity
  feed are required. `loadPlanGenerationContext` (`plans/generationContext.ts`)
  checks the account's model before the Garmin sync, so a missing key is reported
  without syncing. See `docs/specs/api-dependency-wiring.md`,
  `docs/specs/plan-input-loading.md` and ADR 0023.
- **Keep exported constants above exported functions.** Top-level `export const`
  declarations come before `export function` declarations, enforced by the
  `local/consts-before-functions` ESLint rule.

## Spec index

Every spec under `docs/specs/`, grouped by area; `scripts/docs.test.ts` fails when
a spec is missing.

**Plan and coaching:** `docs/specs/coach-plan-lifecycle.md`, `docs/specs/coach-plan-prompts.md`, `docs/specs/coach-run-cancellation.md`, `docs/specs/plan-finalisation.md`, `docs/specs/plan-generation-modules.md`, `docs/specs/plan-generation-progress.md`, `docs/specs/plan-input-loading.md`, `docs/specs/plan-json-repair.md`, `docs/specs/plan-refresh-judgement.md`, `docs/specs/plan-revision-steps.md`, `docs/specs/plan-run-arguments.md`,
`docs/specs/season-block-boundaries.md`, `docs/specs/season-regeneration.md`, `docs/specs/week-outline.md`, `docs/specs/session-purpose.md`, `docs/specs/bike-workout-export.md`, `docs/specs/coach-feedback-and-program-review.md`, `docs/specs/coach-form-awareness.md`, `docs/specs/coach-judgement.md`, `docs/specs/coach-personality.md`, `docs/specs/coach-praise.md`, `docs/specs/coach-questions.md`,
`docs/specs/coach-reply-context.md`, `docs/specs/coach-reply-polling.md`, `docs/specs/period-reviews.md`, `docs/specs/dashboard-layout.md`, `docs/specs/athlete-events.md`, `docs/specs/athlete-question-answers.md`, `docs/specs/versioned-athlete-questions.md`, `docs/specs/coaching-survey-updates.md`.

**LLM and benchmarks:** `docs/specs/openrouter-llm-integration.md`, `docs/specs/llm-benchmark.md`, `docs/specs/llm-call-log.md`, `docs/specs/llm-completion-budget.md`, `docs/specs/llm-model-catalog.md`, `docs/specs/llm-text-formatting.md`, `docs/specs/ai-costs.md`.

**Training data and metrics:** `docs/specs/activity-store.md`, `docs/specs/activity-feed-loading.md`, `docs/specs/activity-analysis-sharing.md`, `docs/specs/activity-deletion.md`, `docs/specs/activity-local-date.md`, `docs/specs/training-load.md`, `docs/specs/fitness-page.md`, `docs/specs/threshold-metrics.md`, `docs/specs/body-metrics.md`, `docs/specs/cadence-units.md`, `docs/specs/calendar-page.md`.

**Garmin:** `docs/specs/garmin-activity-integration.md`, `docs/specs/garmin-sync-known-activities.md`, `docs/specs/garmin-activity-laps.md`, `docs/specs/garmin-activity-metrics.md`, `docs/specs/garmin-strength-exercise-sets.md`, `docs/specs/garmin-daily-health-metrics.md`, `docs/specs/garmin-sidecar-checks.md`, `docs/specs/garmin-sidecar-contract.md`, `docs/specs/garmin-sidecar-modules.md`.

**Diet:** `docs/specs/diet-log.md`, `docs/specs/diet-coaching.md`, `docs/specs/diet-progress-targets.md`, `docs/specs/calorie-breakdown.md`.

**Web:** `docs/specs/accessibility-lint.md`, `docs/specs/chart-keyboard-navigation.md`, `docs/specs/current-user-provider.md`, `docs/specs/modal-dialog.md`, `docs/specs/pwa.md`, `docs/specs/signed-out-landing.md`, `docs/specs/web-api-base-url.md`, `docs/specs/web-api-request-parsing.md`, `docs/specs/web-api-resource-hook.md`, `docs/specs/web-cache-busting.md`, `docs/specs/web-coaching-hooks.md`,
`docs/specs/web-coaching-pages.md`, `docs/specs/web-comment-form.md`, `docs/specs/web-component-library.md`, `docs/specs/web-form-drafts.md`, `docs/specs/web-interaction-tests.md`, `docs/specs/web-routing.md`, `docs/specs/user-time-zone.md`.

**API and backend:** `docs/specs/api-dependency-wiring.md`, `docs/specs/api-errors.md`, `docs/specs/api-logging.md`, `docs/specs/api-server-entry.md`, `docs/specs/api-versioning.md`, `docs/specs/authenticated-user-middleware.md`, `docs/specs/auth-integration.md`, `docs/specs/route-param-validation.md`, `docs/specs/shared-api-boundary.md`, `docs/specs/shared-date-helpers.md`, `docs/specs/shared-package-barrel.md`,
`docs/specs/unused-exports.md`.

**Tests, infrastructure and process:** `docs/specs/database-indexes.md`, `docs/specs/database-integration-tests.md`, `docs/specs/e2e-tests.md`, `docs/specs/test-coverage.md`, `docs/specs/agent-access-script.md`, `docs/specs/ci-build-job.md`, `docs/specs/deploy-workflow.md`, `docs/specs/third-party-notices.md`, `docs/specs/typescript-project-coverage.md`, `docs/specs/error-monitoring.md`, `docs/specs/account-deletion.md`, `docs/specs/admin-settings.md`, `docs/specs/location-and-weather.md`.
