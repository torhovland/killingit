# Spec: Database executor types

- **Status:** Accepted (implemented)
- **Date:** 2026-11-16
- **Related:** issue #522, `docs/specs/database-connection.md`,
  `docs/specs/api-dependency-wiring.md`.

## Goal

A store that can run either on the shared connection or inside a caller's
transaction has to name that type. `metrics/store.ts` and
`questions/adjustments.ts` each derived it from the Drizzle client, and
`coaching/deletions.ts` derived the transaction half again, so a change to the
client's shape had to be repeated in every copy and one copy could quietly fall
behind. Derive the types once, next to the client they describe, and import them.

## Scope

- `apps/api/src/db/index.ts` exports `DbTransaction`, one transaction on the
  pool, and `DbExecutor`, the shared connection or one transaction on it.
- `apps/api/src/metrics/store.ts` and `apps/api/src/questions/adjustments.ts`
  import `DbExecutor` instead of declaring their own copy.
- `apps/api/src/coaching/deletions.ts` imports `DbTransaction` for the helpers
  that are only ever called inside a transaction, so the derivation exists once.
- Narrower writer types such as `Pick<typeof db, "insert">` stay where they are:
  they deliberately expose less than an executor, and that is the point.

## Acceptance criteria

1. `DbExecutor` and `DbTransaction` are declared only in
   `apps/api/src/db/index.ts`; `apps/api/src/db/index.test.ts` scans the API's
   production modules and fails on a second declaration.
2. No store changes behaviour: the types are erased at runtime, and the unions
   and the transaction callback parameters they replace were identical.
3. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
   `bun run check:unused` and `bun run test:coverage` pass.

## Data model and API impact

None. No schema, migration, route, response or prompt change; only a type is
moved to the module that owns the client.
