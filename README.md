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