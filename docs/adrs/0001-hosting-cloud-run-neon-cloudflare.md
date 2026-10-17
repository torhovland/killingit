# ADR 0001: Hosting — Cloud Run (API), Neon (Postgres), Cloudflare Pages (Web)

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** torhovland

## Context

The AI coach app needs hosting that meets the constraints in `AGENTS.md`:

- Cheap. Ideally close to $0/month at low (or zero) usage.
- Bun runtime for the Hono API.
- PostgreSQL with a real driver connection (Drizzle ORM).
- The coding agent must be able to query the database and read app logs via a
  documented script (observability/agent-access requirement).
- Per-user LLM keys (OpenRouter by default) as an outbound, provider-agnostic
  dependency — no hosting tie.

## Decision

- **API (Hono + Bun):** Google Cloud Run, container (Docker), on the always-free
  tier in `us-central1`. Scales to zero when idle.
- **Database (PostgreSQL):** Neon free tier (0.5 GB storage, 100 CU-hours/month,
  autosuspend on), reached over a standard Postgres connection string.
- **Web (React + Vite):** Cloudflare Pages, built static assets with native SPA
  fallback, served on the same apex domain as the API.
- **Domains:** `killingit.hovland.co` (production) and
  `killingit-test.hovland.co` (test).

### Why Cloud Run (and not Cloud SQL)

Cloud Run has a genuine always-free tier (180k vCPU-seconds, 360k GiB-seconds,
2M requests/month, scale-to-zero) with no time limit. It runs a Docker/Bun
image directly, so the existing Hono + Bun stack deploys unchanged.

Cloud SQL was explicitly rejected: it has **no** always-free tier and its
cheapest Postgres instance (`db-f1-micro`) is ~$8/month — higher than the whole
budget target. The database therefore stays on Neon.

### Why Cloudflare Pages for the web (and not inside Cloud Run)

Serving the static web app from Cloudflare means the HTML/JS/CSS load at the
edge with no cold start, while only the `/api` calls hit Cloud Run's
scale-to-zero latency. Colocating the web app inside Cloud Run would make the
entire first paint wait for a container boot.

### Rejected alternatives

- **Railway / Fly.io:** both now have a $5/month minimum-spend floor with no
  free tier. Managed, but not cheaper than $0.
- **Hetzner VPS + Coolify:** cheapest self-managed (~€4–6/month) and best agent
  access, but the user prefers managed; the Neon DB already gives clean
  `psql`/CLI access without SSH.
- **Cloudflare Workers for the API:** $0 and Hono-native, but long-running
  OpenRouter LLM generations fit poorly in Workers' CPU/duration limits.
- **GitHub Pages for the web:** free but has no native SPA fallback (requires a
  `404.html`/`HashRouter` hack) and no custom headers. Cloudflare Pages is
  strictly better at the same price.

## Cost at zero usage

| Component                     | Cost                                                |
| ----------------------------- | --------------------------------------------------- |
| Cloud Run (API)               | ~$0 (always-free tier, scale-to-zero)               |
| Neon (Postgres)               | $0 (free tier)                                      |
| Cloudflare Pages              | $0 (free tier)                                      |
| Auth0                         | $0 (free plan; custom social connections to verify) |
| Sentry                        | $0 (Developer plan)                                 |
| Open-Meteo (weather/daylight) | $0                                                  |
| OpenRouter (LLM)              | $0 at zero usage (per-token)                        |

The only metered items are Cloud Run egress beyond the free allowance and LLM
tokens, both ~$0 at low traffic.

## Environments

| Environment | Domain                      | Deploy trigger              |
| ----------- | --------------------------- | --------------------------- |
| Test        | `killingit-test.hovland.co` | Automatic on push to `main` |
| Production  | `killingit.hovland.co`      | Manual approval (see CI)    |

## Consequences

- **Positive:** ~$0/month at low usage; managed; the agent can query Neon via
  `psql` and read Cloud Run logs via `gcloud run services logs read` (scripted in
  `scripts/`).
- **Negative:** Cloud Run free tier is restricted to `us-central1`, so athletes
  outside North America see extra API latency; scale-to-zero imposes a cold
  start on the first API request after idle.
- **Follow-ups:** resolved by ADR 0002 (Auth0 Free plan adopted; social
  connections for Strava/Garmin are social, not enterprise).

## References

- `AGENTS.md` — Hosting, Database, Observability, Auth sections.
- `scripts/` — documented agent-access scripts (`agent.sh`).
- `.github/workflows/deploy.yml` — test/production deploy pipeline.

## Deployment details

- GCP project: `killingit`.
- Neon DB region: AWS `us-east-2` (Ohio), the network-closest AWS region to
  GCP `us-central1` (Iowa), minimizing DB round-trip latency.
- Neon project: `round-thunder-33526865`, with two branches — `production`
  and `test` — both in `us-east-2`. Each exposes a pooled (`DATABASE_URL`,
  runtime) and an unpooled (`DATABASE_URL_UNPOOLED`, migrations) connection
  string. The app reads `DATABASE_URL` at runtime; `drizzle.config.ts` reads
  `DATABASE_URL_UNPOOLED` for migrations.
- Migrations run automatically in CI (before each Cloud Run deploy) against
  the unpooled URL, so deploys self-migrate.
- Container registry: Google Artifact Registry. The API image is pushed to
  `us-central1-docker.pkg.dev/killingit/<repo>/killingit-api:<sha>`.
- CI/CD: GitHub Actions — test deploys automatically on `main`; production
  requires a manual `workflow_dispatch` against the `production` environment.
