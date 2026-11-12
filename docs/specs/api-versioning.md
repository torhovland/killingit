# Spec: API contract version handshake

- **Status:** Accepted (implemented)
- **Date:** 2026-11-11
- **Related:** `docs/adrs/0028-api-version-handshake.md`,
  `docs/specs/pwa.md`, `docs/specs/authenticated-user-middleware.md`,
  `docs/specs/web-api-request-parsing.md`

## Goal

A frontend that outlives an incompatible API change must fail fast and
visibly, and recover by itself, instead of surfacing a schema error from
whichever request happened to notice first. The web app is installed as a PWA
and the API deploys separately, so an old bundle can stay open — or resume from
the background — across several API deploys.

## Scope

### In scope

1. One contract version in `packages/shared/src/apiVersion.ts`:
   `API_CONTRACT_VERSION`, `API_MIN_SUPPORTED_VERSION`, and the
   `x-killingit-api-version` header name.
2. The web app sends the current version on every API request, in the two
   choke points of `apps/web/src/fetchAuthed.ts` (JSON and file downloads).
3. The API enforces a supported range in
   `apps/api/src/apiVersion.ts`, mounted on `/api/*` before authentication and
   skipped for the public allowlist (`/api/health`, `/api/greet`).
4. A refused build gets `426` with the standard error contract
   (`docs/specs/api-errors.md`):

   ```json
   {
     "error": {
       "code": "api_version_mismatch",
       "message": "This app version is out of date. Reload to update.",
       "details": { "requiredVersion": 1, "receivedVersion": "0" }
     }
   }
   ```

   A missing header is refused too, so a build from before the handshake
   updates once.

5. The web reacts to a `426` by reloading once (through the PWA update path, so
   a waiting worker is activated first). A repeated mismatch inside a
   minute-long cooldown sets the existing update banner instead of reloading in
   a loop; its Reload action goes through the same path.
6. Deploy order: the API deploys before the web (`.github/workflows/deploy.yml`
   job dependencies), and a contract bump keeps the previous version supported
   for one release.

### Out of scope

- Version prefixes in the URL (`/api/v1/...`), content negotiation, or
  per-endpoint versions. There is one first-party client and one contract.
- Supporting an old build indefinitely. The minimum supported version is raised
  in a follow-up release once the matching web build is everywhere.
- Detecting an incompatible change without a version bump. The constant is a
  manual promise; a shape change that forgets to bump it is still a bug.

## Rules

- Bump `API_CONTRACT_VERSION` whenever a request or response shape changes
  incompatibly. Additive, optional fields do not need a bump.
- After the web deploy that speaks the new contract is out, raise
  `API_MIN_SUPPORTED_VERSION` in a follow-up release. That leaves one release
  where both versions are accepted, which is what lets the two deploys overlap.
- A `426` is a version mismatch, never a transient failure: the web does not
  retry the request, it reloads and retries through the new shell.
- A `503` from the API keeps its existing meaning (account store unavailable) and
  is unrelated to this handshake.

## Acceptance criteria

1. Every authenticated API request from the web carries
   `x-killingit-api-version` with `API_CONTRACT_VERSION`, including file
   downloads.
2. The API returns `426` for a lower version, a higher version, and a missing
   version, and lets a supported version reach authentication.
3. `/api/health` and `/api/greet` work without the header, so monitoring and
   the smoke test are unaffected.
4. A `426` triggers exactly one automatic reload per cooldown window; a second
   mismatch shows the update banner, whose Reload action repeats the update.
5. The web and API both typecheck, lint, format, and pass their tests.
