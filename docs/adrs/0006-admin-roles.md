# ADR 0006: Admin roles and the admin settings page

- **Status:** Accepted (amended 2026-11-12: the admin is provisioned
  explicitly, never promoted implicitly)
- **Date:** 2026-10-21
- **Deciders:** torhovland

## Context

The app is moving from a single-operator phase to multiple accounts. Some
configuration — starting with the versioned athlete questions (ADR 0005) — must
be managed by one trusted account, not by every athlete who signs in.

Accounts are created in Auth0, which is the identity provider; the API only
learns about a user when they first present a valid access token. Authorisation
must therefore be owned by our database rather than inferred from a token claim
or an environment allowlist of every account, so it keeps working if the
provider changes (ADR 0002). Naming the one administrator is operator
configuration, not a token claim: it decides which stored role an account is
granted, while the role itself lives in the database.

The admin role is powerful: the admin can read every account's `llm_calls`,
which contain other athletes' health and diet data. Provisioning therefore must
not hand the role to whoever happens to be first. Earlier versions promoted the
earliest member whenever no admin existed, so an admin deleting their account
silently granted that access to a stranger. The admin is now provisioned
explicitly instead.

## Decision

- **Accounts live in a `users` table.** Each row is keyed by the auth provider's
  subject (`auth_subject`, unique) and carries an application role (`admin` or
  `member`, constrained by a check). The role is never read from a token.
- **Provision on first authenticated request.** `/api/me` and the admin routes
  call `UserStore.ensureUser(sub)`, which inserts the account if it is missing.
  This is the app's definition of "creating an account" for a provider-hosted
  identity.
- **The admin is provisioned explicitly.** `ADMIN_AUTH_SUBJECT` names the one
  auth subject that is allowed to administer the environment. A new account
  with that subject is an `admin`; every other account is a `member`. An
  existing member is promoted only when its subject matches the configured
  value, which is how an operator grants the role to an account that signed in
  before the variable was set. With no value configured, every account is a
  member.
- **No implicit promotion.** Provisioning never promotes the earliest account,
  the first account in an empty database, or any account just because no admin
  exists. Deleting the admin leaves the environment without one until the
  configured subject signs in again or an operator updates the role directly.
  Provisioning runs in a transaction under a PostgreSQL advisory lock, so two
  concurrent first sign-ins cannot both insert the same account.
- **Existing data keeps its stored role.** The migration that introduced the
  role column backfilled the earliest account as a one-time repair. Provisioning
  no longer repeats that repair, so a role that is already stored is never
  changed by the absence of an admin.
- **Enforce roles in the API.** `requireAdmin()` runs after `requireUser` and
  returns `403` for members; a failure to resolve the account earlier is a `503`
  (an infrastructure failure is not a denial). All routes under `/api/admin/*`
  use it.
- **Admin settings page.** The web app shows an "Admin settings" page only when
  `/api/me` reports `role: "admin"`. The page currently contains athlete
  question management. Hiding the page is convenience; the API is the
  enforcement point.

## Consequences

- **Positive:** authorisation is explicit and testable; no token configuration is
  required in Auth0; the bootstrap is race-safe and idempotent; an account
  deletion can never hand admin access to another athlete; the UI and API agree
  on who is an admin.
- **Negative / limits:** every admin request resolves the account (one indexed
  lookup once provisioned); the environment has no admin until an operator sets
  `ADMIN_AUTH_SUBJECT` (and the configured subject signs in); there is no UI to
  invite, demote, or promote other admins yet — those are direct database
  updates; accounts are provisioned on first API request rather than at Auth0
  signup.
- **Follow-ups:** add admin management (invite/promote/demote), move other
  operator-only integration config (Garmin, LLM) onto the admin page, and
  consider an audit log for role changes.

## Rejected alternatives

- **Auth0 roles/permissions in the access token:** couples authorisation to the
  IdP and requires tenant configuration; a provider swap would lose it.
- **Promoting the earliest account when no admin exists:** the bug this decision
  fixes. It gives a stranger access to every account's LLM calls after the admin
  leaves.
- **Making the first account in an empty database the admin:** still implicit,
  and an environment can be emptied by deleting accounts. An explicit subject
  makes the grant deterministic and auditable.
- **A CLI promote command:** workable, but the environment variable is simpler
  to set on Cloud Run, is read at request time, and needs no shell or database
  access from an operator's machine.
- **"Everyone is an operator" (ADR 0005's original phase):** no longer safe once
  athletes share an environment; anyone could rewrite onboarding questions.
- **Deciding the admin at migration time only:** misses a fresh environment that
  is migrated before anyone signs in.

## References

- `docs/specs/admin-settings.md` — implementation spec.
- `docs/adrs/0005-versioned-athlete-questions.md` — the question admin surface.
- `docs/adrs/0002-auth0-authentication.md` — provider-agnostic auth boundary.
- `AGENTS.md` — development methodology and quality gates.
