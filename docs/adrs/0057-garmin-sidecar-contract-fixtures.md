# ADR 0057: Commit sidecar response fixtures and check them from both languages

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/garmin-sidecar-contract.md`, ADR 0055, issue #338

## Context

The Garmin sidecar is Python and builds its response dicts by hand. The app is
TypeScript and owns the Zod schemas that parse those bodies. The two sides live
in one repository but in two type systems, so a renamed field on either side
was invisible until an athlete synced and the API rejected the payload. The
existing tests could not catch it: the Python suite asserts Python dicts against
Python literals, and the API tests parse TypeScript fixtures against the
schemas. Each side agreed with itself.

Two designs were available. One is to generate Python models from the Zod
schemas, so the sidecar cannot emit a field the contract does not know. The
other is to commit one response fixture per endpoint and check it from both
languages: the sidecar proves it still produces those bytes, and the API proves
the schemas still parse them.

## Decision

Commit the fixtures and check them from both sides.

- `services/garmin/contract/{sync,metrics,daily}.json` hold each endpoint's
  whole response body, built by the sidecar's own route handlers from raw
  Garmin payloads kept in `services/garmin/contract_fixtures.py`.
- `services/garmin/test_contract.py` re-runs the handlers and asserts equality,
  so the sidecar's output is pinned byte for byte.
- `apps/api/src/garmin/contract.test.ts` parses the same files with
  `activitiesResponseSchema`, `garminMetricsResponseSchema` and
  `garminDailyResponseSchema`, and asserts the parsed fields the app reads.
- Regeneration is one documented command
  (`UPDATE_CONTRACT_FIXTURES=1 .venv/bin/python -m pytest test_contract.py`);
  the normal test run only reads.

The Bun half lives in `apps/api` rather than `packages/shared` because the
module that parses the sidecar body in production is
`apps/api/src/garmin/client.ts`, and because the shared package holds the wire
contract without knowing which service produced it (ADR 0055). When this test
fails, the failure belongs to the client's parse, next to the client.

## Alternatives considered

- **Generate Pydantic models from the Zod schemas.** It is the stronger
  guarantee: an emitted field would have to exist on the model. But the
  schemas are TypeScript expressions, not data — refinements, defaults,
  `.extend()`, `z.partialRecord` over an enum, and `.default([])` all appear in
  the three schemas — so a converter would either be a new tool with its own
  bugs or would hand-maintain a JSON-Schema export next to the Zod source. The
  sidecar would also gain a second source of truth for its own dicts (`TypedDict`
  or dataclasses that mirror the models) and a code-generation step in
  `bun run check:garmin`. Most of the field renames this is meant to catch are
  also caught by a fixture, at a fraction of the moving parts. Rejected.
- **Call the sidecar from the Bun test at test time.** It needs Python, a
  virtualenv and FastAPI inside `bun run test`, and the CI `test` job would gain
  a Python install. A committed fixture keeps each job in its own language and
  still catches the drift. Rejected.
- **Have pytest write the fixtures during the test run and let Bun read them
  afterwards.** The two test jobs run independently in CI, so there is no
  ordering guarantee, and a test that writes into the checkout is a footgun for
  every later reader of the tree. Rejected.
- **Assert only that the fixture parses.** Zod strips unknown keys, so a
  Python-side rename such as `power` → `powerWatts` would still parse and the
  test would pass while the field silently vanished. The Bun test therefore
  asserts the parsed values, and the Python test compares against the committed
  bytes. Rejected as stated.

## Consequences

- A rename on either side fails a pull request: the Python suite when the
  sidecar's output changes, the Bun suite when the schemas stop accepting it.
- A deliberate wire change is a two-command loop: regenerate the fixtures, then
  make the schemas and consumers match. The regenerated diff is reviewable, so
  the contract change is visible in the pull request.
- Adding a metric to `DAILY_HEALTH_METRIC_KEYS` fails the Bun test until the
  daily fixture carries it, which is the intended pressure: the sidecar has to
  emit it for the catalog to be honest.
- The fixtures are a snapshot of the shapes the sidecar produces from the raw
  payloads beside them, not of live Garmin. A change in Garmin's own payloads
  still shows up as an omitted channel, which the normalizers already omit
  safely and their unit tests cover.
- A future sidecar endpoint needs its own fixture and its own schema; the
  contract test asserts the fixture directory holds exactly the three files it
  knows, so a new endpoint cannot slip in unchecked.
