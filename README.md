# Killing It

An AI coach app that builds a dynamic training program which reacts to your
workouts.

> Early-stage boilerplate. See [`AGENTS.md`](./AGENTS.md) for the product vision
> and development methodology.

## Stack

- **Monorepo:** Bun workspaces
- **Web:** React + TypeScript + Vite + Tailwind CSS
- **API:** Hono + TypeScript
- **Shared:** Zod schemas + shared types (workspace package)
- **DB:** PostgreSQL + Drizzle ORM
- **Garmin:** Python sidecar (FastAPI + `python-garminconnect`) — see
  `services/garmin/` and ADR 0003.
- **LLM:** OpenRouter chat completions behind a provider-agnostic interface —
  see ADR 0004. The operator enters an API key and picks a model in the app.

## Layout

```
apps/
  web/       React frontend (Vite)
  api/       Hono backend (Drizzle + Postgres)
packages/
  shared/    Shared Zod schemas and types
services/
  garmin/    Python Garmin sync sidecar (FastAPI + python-garminconnect)
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.4
- Docker (for the local Postgres database)

## Getting started

```sh
# Install dependencies
bun install

# Start Postgres
bun run db:up

# Apply migrations (creates tables)
bun run db:migrate

# Run the API and web app together
bun run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001/api

The web dev server proxies `/api` requests to the API, so the frontend can call
`/api/...` directly.

## Environment

Copy `.env.example` to `.env` and adjust as needed. Defaults work for local
development out of the box.

## Scripts

| Command               | Description                     |
| --------------------- | ------------------------------- |
| `bun run dev`         | Run web + api dev servers       |
| `bun run dev:web`     | Run web dev server only         |
| `bun run dev:api`     | Run api dev server only         |
| `bun run build`       | Build all packages              |
| `bun run typecheck`   | Typecheck all packages          |
| `bun run test`        | Run all tests                   |
| `bun run db:up`       | Start Postgres (docker compose) |
| `bun run db:down`     | Stop Postgres                   |
| `bun run db:generate` | Generate a Drizzle migration    |
| `bun run db:migrate`  | Apply Drizzle migrations        |

## Database

The `athletes` table is a placeholder proving the Drizzle wiring. The real
athlete-profile and training data model will replace it.

Integration tables: `garmin_connections` (encrypted Garmin credentials),
`llm_settings` (encrypted OpenRouter key + selected model),
`activity_analyses` (cached coach analysis per activity/model), and
`questions` / `question_versions` (versioned athlete questions; see ADR 0005).
See ADR 0003, ADR 0004, ADR 0005, and the specs in `docs/specs/`.

## Error monitoring (Sentry)

Two Sentry projects — `killingit-api` and `killingit-web` — keep backend and
frontend events separate, linked by distributed tracing (`trace_id`).

The API reports errors and transactions via `@sentry/hono` + `@sentry/bun`. It
is enabled only when `SENTRY_DSN` is set; otherwise Sentry is a no-op (local dev
default, unless `.env.local` carries a DSN, and the unit-test suite).

- **Instrumentation:** `apps/api/src/instrumentation/sentry.ts` registers the
  `sentry()` middleware from `@sentry/hono/bun`, which continues incoming
  distributed traces (`sentry-trace` / `baggage`) and captures unhandled errors.
- **Source maps:** the `apps/api/Dockerfile` build stage bundles with
  `--sourcemap=external`, injects debug IDs, and uploads them via `sentry-cli`
  (using the `SENTRY_AUTH_TOKEN` BuildKit secret + `SENTRY_ORG` /
  `SENTRY_PROJECT` / `SENTRY_RELEASE` build args), so production backend stack
  traces un-minify back to source.
- **Config:** `SENTRY_DSN` (required) and `SENTRY_RELEASE` (optional, set from
  `github.sha` in CI) are read at runtime and injected by the deploy pipeline
  from the `TEST_SENTRY_DSN` / `PROD_SENTRY_DSN` repo secrets.
- **Reading Sentry from the agent:** the Sentry MCP server is configured under
  `.opencode/opencode.json`. Authenticate once with `/mcps` → select `sentry` →
  sign in.

### Auth0 (authentication)

See ADR 0002 and `docs/specs/auth-integration.md`. The web app (SPA) signs in
via Auth0; the API verifies access tokens (RS256) against the tenant JWKS. The
tenant, application, API resource server, and client grant are managed via the
**Auth0 MCP server** configured under `.opencode/opencode.json`.

- **Agent access:** the launcher `scripts/auth0-mcp.sh` mints a fresh
  Management API token on each launch (client-credentials/M2M grant) rather
  than relying on the OS keychain, so it works in OpenCode's clean environment
  and never holds a stale token. It reads `AUTH0_M2M_CLIENT_ID` /
  `AUTH0_M2M_CLIENT_SECRET` from the gitignored `.env.auth0.local` (see
  `.env.auth0.local.example`).
- **Config:** `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`,
  `VITE_AUTH0_AUDIENCE` (`apps/web/.env.local`, `VITE_` prefix required for
  client bundling), and `AUTH0_ISSUER`, `AUTH0_AUDIENCE` (API runtime).
  Documented in `.env.example`.
- **Note:** the Auth0 MCP server exposes no Connections tools; social
  connections (Google/Apple/…, and Strava/Garmin as custom OAuth2) are
  configured in the Auth0 dashboard.

The web app reports browser errors and tracing via `@sentry/react`, enabled
only when `VITE_SENTRY_DSN` is set at build time.

- **Instrumentation:** `apps/web/src/instrument.ts` initializes Sentry
  (`browserTracingIntegration` + `tracesSampleRate` + `tracePropagationTargets`
  to link frontend and backend spans); `apps/web/src/main.tsx` imports it first
  and wires React 19 error hooks to capture uncaught, caught, and recoverable
  errors.
- **Source maps:** `apps/web/vite.config.ts` enables source maps and uploads
  them via `@sentry/vite-plugin` when `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` +
  `SENTRY_PROJECT` are set, so production stack traces un-minify.
- **Config:** `VITE_SENTRY_DSN` is read from the environment by the Vite build
  and injected from `TEST_VITE_SENTRY_DSN` / `PROD_VITE_SENTRY_DSN` in the
  deploy pipeline; source-map upload uses `SENTRY_AUTH_TOKEN` (secret),
  `SENTRY_ORG`, and `SENTRY_PROJECT`.

## Hosting

See [`docs/adrs/0001-hosting-cloud-run-neon-cloudflare.md`](./docs/adrs/0001-hosting-cloud-run-neon-cloudflare.md)
for the decision record. Summary:

| Concern               | Service                                                               |
| --------------------- | --------------------------------------------------------------------- |
| API (Hono + Bun)      | Google Cloud Run (always-free tier, `us-central1`)                    |
| Garmin sidecar        | Google Cloud Run, private (`--no-allow-unauthenticated`, IAM-invoked) |
| Database (PostgreSQL) | Neon (free tier)                                                      |
| Web (React + Vite)    | Cloudflare Pages                                                      |
| CI/CD                 | GitHub Actions → test (auto, `main`) / production (manual approval)   |

| Environment | Domain                      |
| ----------- | --------------------------- |
| Test        | `killingit-test.hovland.co` |
| Production  | `killingit.hovland.co`      |

### Agent access

The coding agent uses `scripts/agent.sh` to read Cloud Run logs and query the
Neon database:

```sh
scripts/agent.sh logs api --env test
scripts/agent.sh sql "SELECT * FROM athletes;" --env test
```

It reads `GCP_PROJECT` and `DATABASE_URL` from the environment.

### Deployment runbook (one-time setup)

The deploy pipeline is in `.github/workflows/deploy.yml`. Configure these once:

**Google Cloud** — already provisioned:

- Artifact Registry repo: `us-central1-docker.pkg.dev/killingit/killingit`
- WIF provider: `projects/619021024164/locations/global/workloadIdentityPools/github-pool/providers/github`
- CI service account: `github-actions-deploy@killingit.iam.gserviceaccount.com`
  (roles: `roles/run.admin`, `roles/artifactregistry.writer`,
  `roles/iam.serviceAccountUser`)
- Test API URL: `https://killingit-api-test-kvfoqc3ktq-uc.a.run.app`
  (swap `-test-` for the production service once created)

**Neon**

1. Two branches on project `round-thunder-33526865`, both in AWS `us-east-2`:
   `production` and `test`. Link with:
   ```sh
   npx neon link --project-id round-thunder-33526865 --branch production -y
   npx neon env pull --project-id round-thunder-33526865 --branch test --file .env.test.local
   ```
2. Each branch exposes two URLs (see `.env.local` / `.env.test.local`):
   - `DATABASE_URL` — pooled (runtime)
   - `DATABASE_URL_UNPOOLED` — direct (migrations)

The `DATABASE_URL` values go to `TEST_DATABASE_URL` / `PROD_DATABASE_URL`;
the `DATABASE_URL_UNPOOLED` values go to `TEST_DATABASE_URL_UNPOOLED` /
`PROD_DATABASE_URL_UNPOOLED`. Migrations run automatically in CI (unpooled).

**Cloudflare Pages**

1. Create two Pages projects (`killingit-web-test`, `killingit-web-prod`).
2. Create an API token with Pages:Edit permission; record `CLOUDFLARE_API_TOKEN`
   and `CLOUDFLARE_ACCOUNT_ID`.

**GitHub repo secrets / variables**

| Name                             | Kind   | Value                                                                                       |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `GCP_PROJECT`                    | var    | `killingit`                                                                                 |
| `GCP_PROJECT_NUMBER`             | var    | `619021024164` (used to address the default runtime service account)                        |
| `ARTIFACT_REGISTRY`              | var    | `us-central1-docker.pkg.dev/killingit/killingit`                                            |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | secret | `projects/619021024164/locations/global/workloadIdentityPools/github-pool/providers/github` |
| `GCP_SERVICE_ACCOUNT`            | secret | `github-actions-deploy@killingit.iam.gserviceaccount.com`                                   |
| `CLOUDFLARE_API_TOKEN`           | secret | Pages:Edit token                                                                            |
| `CLOUDFLARE_ACCOUNT_ID`          | secret | Cloudflare account ID                                                                       |
| `CF_PAGES_TEST`                  | var    | `killingit-web-test`                                                                        |
| `CF_PAGES_PROD`                  | var    | `killingit-web-prod`                                                                        |
| `TEST_API_URL`                   | var    | test Cloud Run service URL                                                                  |
| `PROD_API_URL`                   | var    | production Cloud Run service URL                                                            |
| `TEST_DATABASE_URL`              | secret | Neon test branch pooled (`DATABASE_URL`)                                                    |
| `PROD_DATABASE_URL`              | secret | Neon production branch pooled (`DATABASE_URL`)                                              |
| `TEST_DATABASE_URL_UNPOOLED`     | secret | Neon test branch direct (`DATABASE_URL_UNPOOLED`)                                           |
| `PROD_DATABASE_URL_UNPOOLED`     | secret | Neon production branch direct (`DATABASE_URL_UNPOOLED`)                                     |
| `TEST_SENTRY_DSN`                | secret | Sentry DSN for the test API (`killingit-api`)                                               |
| `PROD_SENTRY_DSN`                | secret | Sentry DSN for the production API (`killingit-api`)                                         |
| `TEST_GARMIN_CREDENTIALS_KEY`    | secret | Passphrase for encrypting Garmin credentials at rest (test)                                 |
| `PROD_GARMIN_CREDENTIALS_KEY`    | secret | Passphrase for encrypting Garmin credentials at rest (production)                           |
| `TEST_LLM_CREDENTIALS_KEY`       | secret | Passphrase for encrypting the OpenRouter API key at rest (test)                             |
| `PROD_LLM_CREDENTIALS_KEY`       | secret | Passphrase for encrypting the OpenRouter API key at rest (production)                       |
| `TEST_VITE_SENTRY_DSN`           | secret | Sentry DSN for the test web build (`killingit-web`)                                         |
| `PROD_VITE_SENTRY_DSN`           | secret | Sentry DSN for the production web build (`killingit-web`)                                   |
| `SENTRY_AUTH_TOKEN`              | secret | Sentry org auth token for source-map upload (org-scoped)                                    |
| `SENTRY_ORG`                     | var    | `killing-it`                                                                                |
| `SENTRY_PROJECT`                 | var    | `killingit-web`                                                                             |
| `AUTH0_DOMAIN`                   | var    | Auth0 tenant domain (`dev-5qhhcjppmcpsomq0.us.auth0.com`); non-secret                       |
| `AUTH0_CLIENT_ID`                | var    | Auth0 SPA client ID (`killingit-web`); non-secret (public by design for a SPA)              |
| `AUTH0_AUDIENCE`                 | var    | API audience `https://api.killingit.hovland.co`                                             |
| `AUTH0_ISSUER`                   | var    | Auth0 tenant issuer (domain + trailing slash); non-secret                                   |

The `production` environment's API/web deploy jobs also require an approval
gate (or protected-environment rule) in the repo settings to make the manual
step real.

**Garmin sidecar**

The deploy workflow builds `services/garmin/Dockerfile` and deploys it as the
private Cloud Run services `killingit-garmin-test` / `killingit-garmin`. It:

- deploys with `--no-allow-unauthenticated`, so only IAM-authorized callers can
  invoke it;
- grants `roles/run.invoker` on the sidecar to the API's runtime service
  account (the Compute Engine default service account, since the API deploy
  does not set `--service-account`);
- passes the resulting URL to the API as `GARMIN_SIDECAR_URL` and
  `GARMIN_SIDECAR_AUDIENCE`. The API mints an OIDC identity token for that
  audience from the Cloud Run metadata server and caches it in memory.

The sidecar keeps Garmin session tokens under `/tmp`, so `--max-instances 1`
avoids repeated Garmin logins (and their 429 rate limit). Set the
`*_GARMIN_CREDENTIALS_KEY` / `*_LLM_CREDENTIALS_KEY` repo secrets to long random
values (e.g. `openssl rand -hex 32`); changing one makes previously stored
ciphertext unreadable, so re-enter the affected credentials afterwards.

**Cloudflare DNS — `hovland.co`**

Point both hostnames at Cloudflare Pages:

- `killingit-test.hovland.co` → `killingit-web-test`
- `killingit.hovland.co` → `killingit-web-prod`
