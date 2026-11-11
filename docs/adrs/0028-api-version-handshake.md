# ADR 0028: Explicit API contract version between the web app and the API

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** torhovland
- **Related:** `docs/specs/api-versioning.md`

## Context

The web app is a static bundle on Cloudflare Pages and the API is a Cloud Run
service. They deploy independently, and the PWA means an installed app can keep
an old bundle open, or resume it from the background, long after a deploy. A
contract change could therefore reach an athlete as a
`ResponseValidationError` from whichever request happens to run first, or, worse,
pass silently when a changed field is still structurally valid.

The API already authenticates every route by default (`requireAuth` /
`requireUser` on `/api/*`). What was missing was any statement of which request
and response shapes this client may use.

## Decision

Put one integer contract version in `packages/shared` and exchange it on every
request through the `x-killingit-api-version` header. The API refuses a version
outside `API_MIN_SUPPORTED_VERSION..API_CONTRACT_VERSION` with `426` and a JSON
body naming both versions, before authentication. The web app treats a `426` as
"this build is out of date": it reloads once through the PWA update path, and a
mismatch that survives the cooldown sets the same update banner a waiting
service worker uses.

The API accepts the previous contract version for one release so the API deploy
can land before the web deploy. Deploy jobs run API-first, and the minimum is
raised in a follow-up release.

## Alternatives

- **URL prefix versioning (`/api/v1/...`).** Keeps several contracts alive at
  once and needs no header, but it means maintaining two live contracts and
  routing every handler twice. This project has one first-party client that can
  be forced to update, so the extra machinery buys nothing.
- **No version; rely on schema validation.** Already the status quo, and it
  fails late, reports an error to the athlete, and misses structurally valid
  semantic changes.
- **Treat a missing header as current.** Avoids breakage on the first rollout,
  but then a bundle from before the handshake is accepted forever, which is
  exactly the stale client this exists to catch.

## Consequences

- A stale bundle fails on its first request with one recognisable status instead
  of a scattered schema error.
- The frontend can lose unsaved input when it reloads for a mismatch. That is
  acceptable because nothing the athlete does works until the app updates.
- A contract bump is a two-release operation: ship both versions, then raise the
  minimum. The spec states that sequence.
- Public endpoints stay version-free, so health checks and monitoring do not
  participate.
- Forgetting to bump the constant leaves the guarantee unenforced; the check is
  only as good as the discipline around the constant.
