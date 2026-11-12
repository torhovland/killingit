# Spec: Admin roles and settings

- **Status:** Accepted (implemented)
- **Date:** 2026-10-21
- **Related:** ADR 0006 (admin roles), ADR 0005 (versioned questions),
  ADR 0002 (Auth0).

## Goal

Give an environment a single trusted administrator and put admin-only
configuration behind an admin settings page. The administrator is named
explicitly by the `ADMIN_AUTH_SUBJECT` environment variable; every other account
is a member. Only the admin can manage the versioned athlete question set and
read the LLM call log. No account is ever promoted implicitly.

## Scope

### In scope

1. **Account table + roles.** Persist users keyed by the auth provider's subject
   with an `admin`/`member` role.
2. **Explicit admin provisioning.** Provision accounts on the first
   authenticated request; the account whose auth subject matches
   `ADMIN_AUTH_SUBJECT` becomes admin, and every other account is a member.
   Serialise concurrent first sign-ins so the same account is not inserted
   twice. An existing member is promoted only when its subject is configured.
3. **No implicit promotion.** Never promote the earliest account, the first
   account in an empty environment, or any account because no admin exists.
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
2. Every account provisioned without `ADMIN_AUTH_SUBJECT` has role `member`,
   including the first account in an empty database.
3. The account whose auth subject matches `ADMIN_AUTH_SUBJECT` is provisioned
   as `admin`, and an existing member with that subject is promoted on its next
   request.
4. Deleting the admin leaves the environment without an admin: the earliest
   remaining member and any later sign-in stay members.
5. Concurrent first sign-ins of one subject provision exactly one account.
6. `GET /api/me` requires auth and returns the caller's `sub` and `role`.
7. `GET|POST|DELETE /api/admin/questions...` returns `401` unauthenticated,
   `403` for a member, and works for an admin.
8. The web app shows the admin nav entry and admin settings page only for
   `role: "admin"`; the questions section is no longer on the coach dashboard.
9. In development and test environments, the date override lives on the admin
   settings page rather than floating over every page, and it renders nothing
   in production.
10. Athlete questions can be reordered from the admin page; the chosen order is
    used for onboarding and coach prompts.
11. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
    pass.

## Data-model / API impact

### Table: `users`

- `id` serial primary key
- `auth_subject` text not null unique
- `role` text not null default `'member'`, check `role in ('admin', 'member')`
- `created_at`, `updated_at` timestamptz not null default now()

Invariants: the admin role comes only from `ADMIN_AUTH_SUBJECT`; a missing
admin is never repaired by promoting an account; accounts are never deleted
implicitly.

### Environment

- `ADMIN_AUTH_SUBJECT` (API runtime, optional) — the auth subject allowed to be
  admin. Empty or unset means the environment has no administrator. Read at
  request time, so setting it and reloading promotes the matching account on its
  next request.

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
- `users/adminSubject.ts` — `configuredAdminSubject`, which reads and trims
  `ADMIN_AUTH_SUBJECT` and treats an empty value as no administrator.
- `users/store.ts` — `UserStore` interface, `planUserProvisioning` (pure
  bootstrap rule: admin only for the configured subject), and
  `dbUserStore.ensureUser` (fast indexed lookup, then a transaction with a
  `pg_advisory_xact_lock` for first-time provisioning; an existing member is
  promoted only when the plan grants admin).
- `auth/middleware.ts` — `requireUser(store)` provisions and stores the account,
  and `requireAdmin()` reads it, returning `403` for members; a provisioning
  failure is `503`.
- `routes/me.ts` — `createMeRoute(store)` returns the validated current user.
- `index.ts` — `createApp({ authProvider, userStore })` injects dependencies for
  DB-free tests and mounts `/api/admin/*` behind `requireAuth` +
  `requireAdmin`.
- `drizzle/0006_*.sql` — creates `users`. Its one-time backfill promoted the
  earliest account when the role column was introduced; provisioning no longer
  performs that repair.

### Web

- `App.tsx` — fetches and validates `/api/me`, adds Coach/Admin settings
  navigation for admins only, and renders the page.
- `AdminSettingsPage.tsx` — admin page shell.
- `AdminQuestionsSection.tsx` — moved from the coach dashboard to the admin
  page; its API calls are unchanged.
- `CoachDashboard.tsx` — no longer renders question management.

## Testing

- **Shared unit tests:** role enum and current-user schema parsing.
- **API unit tests:** `configuredAdminSubject` (set, blank, whitespace) and the
  bootstrap role rule; `requireUser` stores the account and surfaces `503` when
  the store fails; `requireAdmin` allows admins and denies members with `403`;
  `/api/me` returns `sub` + `role` against a fake store; admin questions reject
  unauthenticated (`401`) and member (`403`) callers.
- **Web:** covered by typecheck plus existing component tests; the page shell is
  thin and its access is enforced by the API.
- DB-backed coverage in `apps/api/integration` provisions a member-only
  environment, provisions and promotes the configured subject, and checks that
  deleting the admin leaves every later sign-in a member; see
  `docs/specs/database-integration-tests.md`.

## Risks / open questions

- **Config timing.** The account can sign in before `ADMIN_AUTH_SUBJECT` is set;
  it is created as a member and promoted on its next request once the variable
  names its subject. The web app provisions via `/api/me` immediately after
  sign-in.
- **No admin until configured.** An environment with no `ADMIN_AUTH_SUBJECT` has
  no administrator, so the admin settings page and API are unreachable. This is
  deliberate: a missing configuration must not hand the role to a stranger.
- **No admin recovery UI.** If the admin is lost, set `ADMIN_AUTH_SUBJECT` to the
  intended account's subject or update the role directly in the database.
- **Role changes need a new request.** The UI reads the role from `/api/me` at
  sign-in; promoting a signed-in member takes effect on their next reload.

## Definition of done

- No account is promoted implicitly, including when the admin is deleted.
- The configured subject is admin; every other account is a member; admin
  routes are `403` for members.
- Admin settings page exposes question management to admins only.
- All four quality gates pass.
