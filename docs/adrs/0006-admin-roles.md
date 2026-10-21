# ADR 0006: Admin roles and the admin settings page

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** torhovland

## Context

The app is moving from a single-operator phase to multiple accounts. Some
configuration — starting with the versioned athlete questions (ADR 0005) — must
be managed by one trusted account, not by every athlete who signs in.

Accounts are created in Auth0, which is the identity provider; the API only
learns about a user when they first present a valid access token. Authorisation
must therefore be owned by our database rather than inferred from a token claim
or an environment allowlist, so it keeps working if the provider changes
(ADR 0002).

## Decision

- **Accounts live in a `users` table.** Each row is keyed by the auth provider's
  subject (`auth_subject`, unique) and carries an application role (`admin` or
  `member`, constrained by a check). The role is never read from a token.
- **Provision on first authenticated request.** `/api/me` and the admin routes
  call `UserStore.ensureUser(sub)`, which inserts the account if it is missing.
  This is the app's definition of "creating an account" for a provider-hosted
  identity.
- **The first account is the admin.** Provisioning runs in a transaction under a
  PostgreSQL advisory lock, so concurrent first sign-ins cannot both become
  admin. With zero existing accounts the inserted account is `admin`; otherwise
  it is `member`.
- **Existing data is repaired.** If accounts already exist but none is an
  admin, the earliest account is promoted. This runs both in the migration that
  adds the table (for environments populated before the role column existed) and
  on the next provisioning, so the invariant holds either way.
- **Enforce roles in the API.** `requireAdmin(store)` runs after `requireAuth`,
  resolves the account, returns `403` for members, and `503` if the role cannot
  be resolved (an infrastructure failure is not a denial). All routes under
  `/api/admin/*` use it.
- **Admin settings page.** The web app shows an "Admin settings" page only when
  `/api/me` reports `role: "admin"`. The page currently contains athlete
  question management. Hiding the page is convenience; the API is the
  enforcement point.

## Consequences

- **Positive:** authorisation is explicit and testable; no token configuration is
  required in Auth0; the first-user bootstrap is race-safe and idempotent; the
  UI and API agree on who is an admin.
- **Negative / limits:** every admin request resolves the account (one indexed
  lookup once provisioned); there is no UI to invite, demote, or promote other
  admins yet — those are direct database updates; accounts are provisioned on
  first API request rather than at Auth0 signup.
- **Follow-ups:** add admin management (invite/promote/demote), move other
  operator-only integration config (Garmin, LLM) onto the admin page, and
  consider an audit log for role changes.

## Rejected alternatives

- **Auth0 roles/permissions in the access token:** couples authorisation to the
  IdP and requires tenant configuration; a provider swap would lose it.
- **An environment-variable allowlist of admin subjects:** per-environment
  manual config, awkward to bootstrap, and easy to drift from the database.
- **"Everyone is an operator" (ADR 0005's original phase):** no longer safe once
  athletes share an environment; anyone could rewrite onboarding questions.
- **Deciding the admin at migration time only:** misses a fresh environment that
  is migrated before anyone signs in.

## References

- `docs/specs/admin-settings.md` — implementation spec.
- `docs/adrs/0005-versioned-athlete-questions.md` — the question admin surface.
- `docs/adrs/0002-auth0-authentication.md` — provider-agnostic auth boundary.
- `AGENTS.md` — development methodology and quality gates.
