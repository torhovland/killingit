# Spec: Database indexes and constraints

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** issue #300, `docs/specs/database-integration-tests.md`,
  `docs/specs/coach-questions.md`, `docs/specs/diet-log.md`.

## Goal

Keep one index for each lookup the stores actually perform, and turn the two
rules the write paths already enforce into database constraints, so a second
index does not slow down every write and a bug in a store cannot violate a
rule the schema claims to hold.

## Scope

### In scope

1. Drop indexes that duplicate or prefix a unique index:
   - `athlete_metrics_user_id_metric_idx`, covered by
     `athlete_metrics_user_id_metric_date_idx`;
   - `athlete_thresholds_user_sport_measure_idx`, covered by
     `athlete_thresholds_user_sport_measure_date_idx`;
   - `plan_day_calories_user_id_date_order_idx`, which duplicates
     `plan_day_calories_user_id_date_idx`.
2. Add `manual_activities_user_id_idx`, because every manual-activity query is
   scoped by account.
3. Add `manual_activities` checks for a full `YYYY-MM-DD` start date and
   non-blank details, matching `plan_day_calories` and the other non-blank text
   columns.
4. Add a partial unique index, `coach_questions_user_id_pending_idx` on
   `coach_questions(user_id) WHERE answer IS NULL`, so an account can have at
   most one pending coach question. The migration keeps the newest pending row
   per account before it creates the index, in case older data holds duplicates.

### Out of scope

- A general audit of every table's indexes. Only the tables the issue names are
  changed.
- Replacing the application's `select ... for update` serialization of coach
  question writes. The index is the backstop, not the coordination mechanism.
- Changing the API or any response shape.

## Data model

### `manual_activities`

- index `manual_activities_user_id_idx` on `(user_id)`
- check `manual_activities_start_date_check`: `length(start_date) = 10`
- check `manual_activities_details_check`: `length(btrim(details)) > 0`

### `coach_questions`

- partial unique index `coach_questions_user_id_pending_idx` on `(user_id)`
  where `answer is null`
- existing `(user_id, created_at)` index stays

### Removed indexes

- `athlete_metrics_user_id_metric_idx`
- `athlete_thresholds_user_sport_measure_idx`
- `plan_day_calories_user_id_date_order_idx`

## Behaviour

- A second pending question for one account fails with a unique violation. Two
  accounts can each hold one, an answered question does not occupy the slot, and
  an account may keep any number of answered questions.
- A manual entry with a start date that is not ten characters, or with only
  whitespace as details, fails with a check violation. The API still validates
  the date pattern and the 2,000-character limit before it writes.
- The unique indexes continue to serve the shorter account-and-dimension
  lookups that the removed prefix indexes used to serve.

## Acceptance criteria

1. `bun run test:integration` applies the migration to an empty database and
   asserts the exact index set of the five affected tables.
2. The same suite compares each affected table's Drizzle index definitions with
   the migrated database, so a schema index without a migration (or the reverse)
   fails CI.
3. The integration suite inserts a second pending question and expects the
   unique violation; it then answers the first and inserts the next one.
4. The integration suite rejects a malformed manual start date and blank
   details with a check violation.
5. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.
