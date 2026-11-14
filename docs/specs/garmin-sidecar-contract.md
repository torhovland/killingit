# Spec: Garmin sidecar contract fixtures

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** issue #338, ADR 0057, ADR 0055,
  `docs/specs/garmin-activity-integration.md`,
  `docs/specs/garmin-sidecar-checks.md`.

## Goal

The Python sidecar builds its HTTP response dicts by hand (`to_activity`,
`to_laps`, `to_strength_sets` and `to_samples` in `services/garmin/activities.py`,
`sync_metrics` in `services/garmin/body.py`, `sync_daily` in
`services/garmin/daily.py`) while TypeScript owns
the Zod schemas that parse them (`activitiesResponseSchema`,
`garminMetricsResponseSchema`, `garminDailyResponseSchema`). Nothing compared
the two, so a field rename on either side broke only in production, where the
API turns a mismatched body into a `GarminSidecarError` and the athlete loses
their activity feed, weigh-ins or daily health data.

The contract must fail a pull request instead. This spec pins it from both
sides with one committed set of fixtures.

## Scope

### In scope

1. `services/garmin/contract/` holds one committed JSON file per sidecar
   response body (`sync.json`, `metrics.json`, `daily.json`), each the whole body
   the endpoint returns, plus the `/sync` request body (`sync-request.json`).
2. `services/garmin/contract_fixtures.py` owns the representative raw Garmin
   payloads (activity summaries, activity details with positional metrics,
   splits/lapDTOs, exercise sets, body composition, historic FTP, one day of
   stats/sleep/readiness/max-metrics) and rebuilds the three responses by
   calling the sidecar's own route handlers with a stubbed `auth.login`, so the
   fixture cannot drift from the code path that serves it.
3. `services/garmin/test_contract.py` re-runs those handlers over the raw
   payloads and asserts the result equals the committed JSON, so a Python-side
   rename fails `pytest` (and therefore `bun run check:garmin`). It also
   validates `sync-request.json` through the sidecar's `SyncRequest` model and
   runs that request, so a renamed request field or a request that stops
   skipping a known activity's bulk payloads fails.
4. `apps/api/src/garmin/contract.test.ts` parses the same files with the three
   shared schemas and asserts the fields the app consumes survive, so a
   TypeScript-side rename fails `bun run test`. It also builds the `/sync`
   request body with the API's own `garminSyncRequestBody` and compares it with
   `sync-request.json`.
5. Regeneration is one documented command, and the normal test run never writes
   into the repository.
6. `pyproject.toml` collects the new test module and type-checks the new
   modules alongside the existing ones.

### Out of scope

- Generating Pydantic models from the Zod schemas. See ADR 0057 for why.
- Validating that Garmin's live payloads stay in the shapes the fixtures use.
  A Garmin-side change already surfaces as an omitted field, which the existing
  fail-open normalization and its unit tests cover.
- Covering `/authenticate` and `/health`. They are status-only responses with no
  shared schema; `/sync`, `/metrics` and `/daily` are the bodies the API parses.

## Behaviour

### Fixture contents

Each fixture is representative rather than minimal, so an optional field that
disappears is caught:

- `sync.json` — three activities. A run with a full sample timeseries
  (position, heart rate, power, temperature, speed, cumulative distance,
  elevation, cadence) including a sample that omits position and temperature,
  and three laps that exercise both lap cadence families
  (`averageRunCadence`, the per-leg `avgCadence`). A ride with pedalling
  cadence and an active/rest lap pair. A strength activity with an active set
  carrying weight and exercises, a rest set, and a bodyweight set that records
  no load. The strength activity has no laps, so its `laps` key is absent.
- `metrics.json` — three weigh-ins in grams, pounds and kilograms, two of them
  with body fat, and two historic FTP samples.
- `daily.json` — one day carrying every key in `DAILY_HEALTH_METRIC_KEYS`, so
  the fixture also proves the sidecar's metric names match the catalog.
- `sync-request.json` — a `/sync` request naming the run and the strength
  activity as already stored. The Python half asserts the strength activity's
  sets and the run's samples and laps are omitted, so the fixture pins the field
  name and its meaning rather than just a key.

### Gates

| Side       | Test                                   | Fails when                                        |
| ---------- | -------------------------------------- | ------------------------------------------------- |
| Python     | `services/garmin/test_contract.py`     | a normalizer's output changes, including a rename |
| TypeScript | `apps/api/src/garmin/contract.test.ts` | a shared schema no longer parses or drops a field |
| Both       | `bun run check:garmin`, `bun run test` | either suite above fails                          |

The request body is hand-edited rather than regenerated by the command below;
the Python suite validates it through `SyncRequest` and the Bun suite compares it
with the API's builder. See
`docs/specs/garmin-sync-known-activities.md`.

Both suites already run in CI: `check:garmin` in the `garmin` job and
`bun run test:coverage` in the `test` job.

### Regeneration

```sh
cd services/garmin
UPDATE_CONTRACT_FIXTURES=1 .venv/bin/python -m pytest test_contract.py
```

The document also lives in `services/garmin/README.md`. It rewrites the three
response files; the diff is reviewed like any other wire change, and
`apps/api/src/garmin/contract.test.ts` is what proves the new body still parses.
`sync-request.json` is edited by hand on a deliberate request change.

## Data-model and API impact

None. The sidecar's response schemas, the shared schemas, the API routes and the
stored data are all unchanged; the request body gained its optional
`knownActivityIds` field, which is pinned like the responses. See
`docs/specs/garmin-sync-known-activities.md`.

## Acceptance criteria

- A renamed field in a Python normalizer fails `pytest` until the fixture is
  regenerated deliberately.
- A renamed field in a shared schema fails the Bun test.
- `bun run check:garmin` collects and runs the contract test.
- `bun run test` runs the Bun contract test.
- Neither suite writes into the repository unless regeneration is requested.
- `bun run typecheck`, `bun run lint`, `bun run format` and
  `bun run check:unused` pass.
