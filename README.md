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

## Layout

```
apps/
  web/       React frontend (Vite)
  api/       Hono backend (Drizzle + Postgres)
packages/
  shared/    Shared Zod schemas and types
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

| Command                  | Description                          |
| ------------------------ | ------------------------------------ |
| `bun run dev`            | Run web + api dev servers            |
| `bun run dev:web`        | Run web dev server only              |
| `bun run dev:api`        | Run api dev server only              |
| `bun run build`          | Build all packages                   |
| `bun run typecheck`      | Typecheck all packages               |
| `bun run test`           | Run all tests                        |
| `bun run db:up`          | Start Postgres (docker compose)      |
| `bun run db:down`        | Stop Postgres                        |
| `bun run db:generate`    | Generate a Drizzle migration         |
| `bun run db:migrate`     | Apply Drizzle migrations             |

## Database

The `athletes` table is a placeholder proving the Drizzle wiring. The real
athlete-profile and training data model will replace it.

## Hosting

See [`docs/adrs/0001-hosting-cloud-run-neon-cloudflare.md`](./docs/adrs/0001-hosting-cloud-run-neon-cloudflare.md)
for the decision record. Summary:

| Concern | Service |
| --- | --- |
| API (Hono + Bun) | Google Cloud Run (always-free tier, `us-central1`) |
| Database (PostgreSQL) | Neon (free tier) |
| Web (React + Vite) | Cloudflare Pages |
| CI/CD | GitHub Actions → test (auto, `main`) / production (manual approval) |

| Environment | Domain |
| --- | --- |
| Test | `killingit-test.hovland.co` |
| Production | `killingit.hovland.co` |

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

| Name | Kind | Value |
| --- | --- | --- |
| `GCP_PROJECT` | var | `killingit` |
| `ARTIFACT_REGISTRY` | var | `us-central1-docker.pkg.dev/killingit/killingit` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | secret | `projects/619021024164/locations/global/workloadIdentityPools/github-pool/providers/github` |
| `GCP_SERVICE_ACCOUNT` | secret | `github-actions-deploy@killingit.iam.gserviceaccount.com` |
| `CLOUDFLARE_API_TOKEN` | secret | Pages:Edit token |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Cloudflare account ID |
| `CF_PAGES_TEST` | var | `killingit-web-test` |
| `CF_PAGES_PROD` | var | `killingit-web-prod` |
| `TEST_API_URL` | var | test Cloud Run service URL |
| `PROD_API_URL` | var | production Cloud Run service URL |
| `TEST_DATABASE_URL` | secret | Neon test branch pooled (`DATABASE_URL`) |
| `PROD_DATABASE_URL` | secret | Neon production branch pooled (`DATABASE_URL`) |
| `TEST_DATABASE_URL_UNPOOLED` | secret | Neon test branch direct (`DATABASE_URL_UNPOOLED`) |
| `PROD_DATABASE_URL_UNPOOLED` | secret | Neon production branch direct (`DATABASE_URL_UNPOOLED`) |

The `production` environment's API/web deploy jobs also require an approval
gate (or protected-environment rule) in the repo settings to make the manual
step real.

**Cloudflare DNS — `hovland.co`**

Point both hostnames at Cloudflare Pages:

- `killingit-test.hovland.co` → `killingit-web-test`
- `killingit.hovland.co` → `killingit-web-prod`