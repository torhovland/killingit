# AGENTS.md

## Project Overview

This repository contains an **AI coach app** that is currently under
development. The application uses AI to provide a dynamic training program
that reacts to the user's workouts and updates its advice based on that.

The project is in active development and its structure is still taking shape.
Treat unfamiliar files with care; they may be in-progress work by other
contributors. Investigate before modifying or deleting anything you did not
create.

## Definitions

- **AI coach app** — an application that uses AI to provide a dynamic training
  program.
- **Training block** — a segment of the season made up of a number of weeks
  with a given focus or composition. It may be a traditional block (base,
  build, specialization, taper, …) but does not have to be.
- **Athlete profile** — the structured input a user provides about themselves
  and their training (see "Product").

## Product

The app coaches **amateur athletes**. Onboarding prompts the user for input
describing what kind of coaching they want, their age and location, how much
they want to work out, their goals, their current performance, and similar.
This input forms the athlete profile.

The user can connect their training data from sources such as **Garmin**,
**Strava**, and **Wahoo**.

The app connects to an **LLM** that generates coaching based on the athlete
profile and connected training data. It produces a plan for:

- the season,
- the current training block,
- the current week, and
- today.

It also takes **weather data** and **daylight data** (for the athlete's
location) into account.

The user can revise their input at any time, and the app regenerates the
affected plans.

Most importantly, on each visit the user sees a **suggested workout (or rest)
for today**, possibly with some alternatives as well.

On each visit the user can also get coach analysis of the current season,
block, and week, as well as the last workout. They can provide additional input
about a past workout, or before a suggested workout, to steer the coach.

### LLM

- We use a model from **OpenRouter** by default.
- The user supplies their own API key for OpenRouter; another provider can be
  added later. The LLM integration sits behind a provider-agnostic interface so
  provider choice can be added without rework.
- The current implementation lives behind `LlmProvider`
  (`apps/api/src/llm/openrouter.ts`). Each account's API key is encrypted at
  rest and its chosen model stored in `llm_settings`. Activity analyses are
  cached per account in `activity_analyses`. See ADR 0004.
- The four-level plan is stored per user in `coach_plans`; generation progress
  is in `plan_generations`. After 18:00 the stored plan also carries tomorrow's
  session and, when tomorrow has crossed a week or block boundary, the next week
  and next block, so the Day, Week and Block tabs agree. The next period is
  promoted when today reaches it. The lazy day → week → block cascade and the
  plan UI are documented in `docs/specs/coach-plan-lifecycle.md`.
- The athlete's home location is stored on `users` and set in the settings
  location picker. When a week or day is planned, the API loads Open-Meteo and
  Yr.no forecasts, including sunrise and sunset, builds an averaged combined
  forecast, gives the combined forecast to the coach, and attaches all three to
  outdoor sessions. A significant change in the combined forecast marks the
  week pending and refreshes the week and day. See ADR 0008, ADR 0010, and
  `docs/specs/location-and-weather.md`.
- Completed weeks and blocks get a coach summary, athlete comment, and coach
  reply in `period_reviews` / `coach_replies`; the dashboard and season review
  page are documented in `docs/specs/period-reviews.md`.

## Stack

The stack below is proposed and should be treated as the starting point. See
"Development Methodology" for how decisions like these are made and recorded.

### Frontend

- **React** with **TypeScript**.
- We build up our own **component library** under a `components/` directory.
- **shadcn/ui** + **Tailwind CSS** are the styling foundation. shadcn/ui copies
  source into the repo (rather than installing an opaque npm dependency), so
  component markup and styles are owned, customizable, and versioned with our
  code.

#### CSS strategy

- **Global styling first.** Design tokens — colors, spacing, typography,
  radii, shadows — live as CSS variables in a global stylesheet (the shadcn
  `globals.css` pattern). Global resets and base element styles also live here.
- **Component styling** is colocated in the component via Tailwind utility
  classes that reference the global tokens. Prefer composing existing
  components over one-off styles.
- **Page styles** should go into the React page only when that is the only
  sensible place (e.g. page-specific layout). Keep pages thin; extract
  reusable layout/components instead.
- Use `cn()` (tailwind-merge + clsx) for predictable class merging. Avoid
  inline `style=` attributes and hard-coded magic values; reference tokens.

### Backend

One TypeScript stack end-to-end keeps a single language and shared types
across frontend and backend:

- **Language/runtime:** TypeScript on **Bun** (monorepo via Bun workspaces).
- **API framework:** **Hono** — lightweight, TypeScript-first, runs on Node/Bun
  and edge runtimes, and pairs cleanly with Drizzle. (Fallback: **Fastify**.)
- **ORM:** **Drizzle ORM** — SQL-first and fully type-safe. (Fallback:
  **Prisma**.)
- **Validation:** **Zod** — shared between API handlers and frontend forms.
- **API contract:** a typed client shared across the monorepo, or tRPC/OpenAPI.

### Monorepo layout

- Bun workspaces under `apps/*` and `packages/*`:
  - `apps/web` — React + Vite + Tailwind frontend
  - `apps/api` — Hono + Drizzle backend
  - `packages/shared` — shared Zod schemas and TypeScript types

### Database

- **PostgreSQL**. Managed options (Neon, Supabase) or self-hosted on the host
  provider. Keep it behind a cheap host provider.

### Hosting

- Cheap host provider. Prefer **Railway** or **Fly.io** for low-friction
  managed hosting, or a **Hetzner VPS + Coolify/Caddy** for the cheapest
  self-managed option.

### Auth (third-party login)

We need login via Strava, Garmin, Google, Apple, and others. Google and Apple
are standard "social" IdPs; **Strava and Garmin are the unusual cases** — they
are not built into most auth SaaS and must be configured as **custom
OAuth 2.0** connections.

- **Recommendation: Auth0 Free plan.** It includes 25k monthly active users,
  and (as of the 2024 plan refresh) unlimited social connections **and custom
  social connections**. Google and Apple are native; Strava and Garmin are set
  up as social connections (native where a Marketplace integration exists,
  custom OAuth 2.0 otherwise).
- **Decision / verification:** see ADR 0002. Auth0's own docs disagree on the
  Free plan's social-connection limit ("unlimited" on the pricing page vs "a
  maximum of two" in the Entity Limit Policy). All four of our connections are
  **social** (not enterprise), and the Free plan includes 1 Enterprise
  Connection, so no paid feature is required. A hard gate remains: confirm
  empirically in the tenant dashboard that four social connections work on
  Free before production sign-off, else fall back to Better Auth.
- **Fallback ("build it ourselves"):** self-host **Better Auth** (open source,
  TypeScript, MIT) in our backend. It supports arbitrary OAuth2 providers
  (Google, Apple, Strava, Garmin) at no licensing cost; we own the operational
  responsibility.
- Rejected alternatives: **Kinde** (custom OAuth2 is Pro-only, not free) and
  **Clerk** (free tier limits social connections and custom providers).

Regardless of provider, the Strava/Garmin connections must also grant the data
scopes we need to pull training data — not just identity.

Application roles live in the `users` table, not in provider tokens. The first
account provisioned in an environment is the admin; later accounts are members.
Only the admin can manage athlete questions (see ADR 0006).

### Error monitoring

- **Sentry.io has a free plan** ("Developer"): 5,000 errors/month, 5M spans,
  50 session replays, 1 seat, 30-day retention. Sufficient to start; the Team
  plan ($26/mo) is the upgrade path.

### Weather and daylight data

- Weather from free/cheap APIs (Open-Meteo and Yr.no) and **daylight**
  (sunrise/sunset, from Open-Meteo) at the athlete's location. Treat these as
  providers behind a small interface so sources can be swapped. The app shows
  each source and an averaged combined forecast; the coach plans from the
  combined values. Location (map click or address search) and weather-aware
  planning use the same providers.
- The coach prefers daylight for outdoor sessions. It honours any explicit
  statement the athlete makes about training in darkness and otherwise assumes
  a daylight preference. When a weekday window leaves only working-hour
  daylight, long outdoor sessions move to the weekend.

## Observability and agent access

- The backend should emit **structured (JSON) logs** (e.g. Pino).
- The database and application logs must be **accessible to the coding agent**
  (a documented CLI/script) so the agent can inspect them during debugging and
  when discussing new features.

## Development Methodology

The agent does the coding, but we minimize AI "slop" and unmaintainable code
through a disciplined process:

1. **Spec before code.** For anything non-trivial, write a short spec first:
   goal, scope, acceptance criteria, and data-model/API impact. The agent
   implements against the spec, not a vague prompt.
2. **Test-driven development.** Write failing tests, then implement to make
   them pass. New behavior is always accompanied by tests.
3. **Small, reviewable units of work.** One logical change per task/commit/PR.
   Keep diffs small and limited to a single concern.
4. **Human review gate.** The agent proposes; a human verifies before the
   change is merged.
5. **Static quality enforced everywhere.** TypeScript `strict` (plus the extra
   strictness flags in `tsconfig.base.json`), ESLint, and Prettier are all
   checked in CI (`bun run typecheck`, `bun run lint`, `bun run format`) and
   must pass.
6. **Full test coverage on every feature**, across three layers:
   - **Unit tests** (Vitest) for pure logic and components.
   - **Integration tests** against the API and a test database.
   - **End-to-end tests** (Playwright) for critical user journeys.
     Enforce coverage thresholds in CI (test pyramid: many unit, fewer
     integration, a focused e2e set).
7. **CI pipeline** (GitHub Actions, `.github/workflows/ci.yml`): typecheck +
   lint + format + unit tests + a dependency-outdated check must pass before
   merge. Integration and e2e checks follow the same rule as they are added.
8. **Dependencies stay current.** CI fails the build when any dependency is
   outdated (`bun run outdated`). When that happens, update the outdated
   dependencies with `bun update`, verify typecheck/lint/format/tests still
   pass, and commit the regenerated `bun.lock` (and any `package.json` changes)
   in a separate new commit before pushing.
9. **Decoupled, clearly named code.** Single-responsibility modules, explicit
   dependencies, descriptive names. Don't over-abstract prematurely, but
   extract real duplication.
10. **Documents stay current.** Keep AGENTS.md accurate and write ADRs (a
    decision log) for significant architectural choices.
11. **Definition of done.** A change is done only when tests, types, and lint
    pass.
12. **Clean, readable code first.** Readable, maintainable, clean code is as
    important as working features. If a small feature requires a lot of new
    lines, it is likely not worth it.
13. **Strict review.** When asked to review, be strict and thorough.
    Nitpicking is encouraged. Add your comments to the PR unless everything
    looks good.
14. **Implementation ends in a pull request.** Whenever the human asks you to
    implement something, finish by opening a pull request with the completed
    change. Do not stop at a local edit or an unpushed branch.

## Working side effects

- **Verify CI before pushing.** When asked to push changes, first run
  `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
  locally (or verify the equivalent CI checks pass), and confirm they all
  succeed before pushing.
- **Make sure CI passes on PRs.** When asked to create or update a PR, make
  sure CI passes.

## Development Guidelines

- Keep changes consistent with the existing structure, naming, style, and
  patterns of the surrounding code.
- Treat unfamiliar files or changes as potential user work; do not overwrite or
  delete them without investigating first.
