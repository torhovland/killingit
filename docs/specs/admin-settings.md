# Spec: Admin roles and settings

- **Status:** Accepted (implemented)
- **Date:** 2026-10-21
- **Related:** ADR 0006 (admin roles), ADR 0005 (versioned questions),
  ADR 0002 (Auth0).

## Goal

Give an environment a single trusted administrator and put admin-only
configuration behind an admin settings page. The first account in an
environment is the admin; later accounts are members. Only the admin can manage
the versioned athlete question set. Databases that already contain accounts are
repaired so the earliest account is always an admin.

## Scope

### In scope

1. **Account table + roles.** Persist users keyed by the auth provider's subject
   with an `admin`/`member` role.
2. **First-user bootstrap.** Provision accounts on the first authenticated
   request; the first account becomes admin. Serialise concurrent first
   sign-ins so only one account wins.
3. **Upgrade existing environments.** If accounts already exist without an
   admin, promote the earliest one — in the migration and on the next
   provisioning.
4. **Expose the role.** `GET /api/me` returns `{ sub, role }`.
5. **Admin-only API.** Every route under `/api/admin/*` requires an admin and
   returns `403` for members.
6. **Admin settings page.** A signed-in admin gets an "Admin settings" page that
   contains athlete question management and, in development/test environments,
   the date override used to simulate visiting on another day. Members do not
   see the page.

### Out of scope (deferred)

- Inviting, promoting, demoting, or removing admins through the UI.
- Role/permission claims in the Auth0 token.
- Moving the Garmin and LLM operator configuration onto the admin page.
- Audit logging of role changes.

## Acceptance criteria

1. The `users` table exists with a unique `auth_subject`, a constrained `role`
   (`admin`/`member`), and timestamps.
2. The first account provisioned against an empty database has role `admin`;
   the next account has role `member` and does not change the first.
3. If a database has accounts but no admin, the earliest account is promoted
   (migration backfill and provisioning-time repair are idempotent).
4. Concurrent first sign-ins result in exactly one admin.
5. `GET /api/me` requires auth and returns the caller's `sub` and `role`.
6. `GET|POST|DELETE /api/admin/questions...` returns `401` unauthenticated,
   `403` for a member, and works for an admin.
7. The web app shows the admin nav entry and admin settings page only for
   `role: "admin"`; the questions section is no longer on the coach dashboard.
8. In development and test environments, the date override lives on the admin
   settings page rather than floating over every page, and it renders nothing
   in production.
9. Athlete questions can be reordered from the admin page; the chosen order is
   used for onboarding and coach prompts.
10. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
    pass.

## Data-model / API impact

### Table: `users`

- `id` serial primary key
- `auth_subject` text not null unique
- `role` text not null default `'member'`, check `role in ('admin', 'member')`
- `created_at`, `updated_at` timestamptz not null default now()

Invariants: at most one bootstrap admin is created by first sign-in; accounts
are never deleted implicitly; the earliest account is promoted if no admin
exists.

### Routes

- `GET /api/me` → `{ sub: string, role: "admin" | "member" }` (provisions the
  account on first sight).
- `/api/admin/*` → admin only (`403` for members). Existing
  `/api/admin/questions` routes are unchanged.

### Shared types

`userRoleSchema` and `currentUserSchema` in `packages/shared/src/user.ts`,
re-exported from the package index.

## Technical approach

### API

- `db/schema.ts` — `users` table and inferred row types.
- `users/store.ts` — `UserStore` interface, `roleForNewUser` (pure bootstrap
  rule), and `dbUserStore.ensureUser` (fast indexed lookup, then a transaction
  with a `pg_advisory_xact_lock` for first-time provisioning and the
  promote-earliest repair).
- `auth/middleware.ts` — `requireAdmin(store)` resolves and stores the account,
  returns `403` for members and `503` on infrastructure failure.
- `routes/me.ts` — `createMeRoute(store)` returns the validated current user.
- `index.ts` — `createApp({ authProvider, userStore })` injects dependencies for
  DB-free tests and mounts `/api/admin/*` behind `requireAuth` +
  `requireAdmin`.
- `drizzle/0006_*.sql` — creates `users` and promotes the earliest account when
  no admin exists.

### Web

- `App.tsx` — fetches and validates `/api/me`, adds Coach/Admin settings
  navigation for admins only, and renders the page.
- `AdminSettingsPage.tsx` — admin page shell.
- `AdminQuestionsSection.tsx` — moved from the coach dashboard to the admin
  page; its API calls are unchanged.
- `CoachDashboard.tsx` — no longer renders question management.

## Testing

- **Shared unit tests:** role enum and current-user schema parsing.
- **API unit tests:** the bootstrap role rule; `requireAdmin` allows admins,
  denies members with `403`, and surfaces `503` when the store fails; `/api/me`
  returns `sub` + `role` against a fake store; admin questions reject
  unauthenticated (`401`) and member (`403`) callers.
- **Web:** covered by typecheck plus existing component tests; the page shell is
  thin and its access is enforced by the API.
- DB-backed integration tests remain deferred until CI provisions Postgres (same
  policy as the rest of the repository).

## Risks / open questions

- **Bootstrap timing.** "First account" means the first account the API
  provisions — the web app does this via `/api/me` immediately after sign-in —
  not the first account created in Auth0. A user who signs up but never opens
  the app does not consume the admin slot.
- **No admin recovery UI.** If the admin is lost, promote another account
  directly in the database.
- **Role changes need a new request.** The UI reads the role from `/api/me` at
  sign-in; promoting a signed-in member takes effect on their next reload.

## Definition of done

- Migration creates `users` and backfills the first admin when applicable.
- First sign-in is admin; later sign-ins are members; admin routes are `403` for
  members.
- Admin settings page exposes question management to admins only.
- All four quality gates pass.
