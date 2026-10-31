# ADR 0016: Graded model catalog and split season/day model choices

## Context

The Settings page asked athletes to type an OpenRouter model id. That made a
typo look like a coaching failure, hid how expensive or slow a model was, and
gave every prompt the same model even though season planning and day-to-day
replies have different cost, latency and reasoning needs. OpenRouter's catalog
also changes without notice.

## Decision

Store every OpenRouter model in `llm_models` with retired/discouraged flags and
ability, speed and cost grades derived from the today-prompt benchmark. Refresh
the catalog in the background on a page visit, at most once every 24 hours, and
mark models missing from OpenRouter as retired.

Replace the free-text model field with one sortable, filterable table and two
selections: a season model for season plans, season refreshes and block
planning, and a daily model for week/day planning and every routine prompt.
Before a prompt runs, check the selected model against the catalog and fail with
a Settings-page instruction if it is retired or discouraged.

## Consequences

- Athletes choose from measured options instead of typing ids.
- The expensive reasoning model is reserved for season/block work.
- A catalog refresh cannot overwrite benchmark grades.
- Retired choices stay visible so an athlete can see what they were using.
- New models remain `?` until the benchmark runs; the documented pending-only
  benchmark command fills those gaps.
- The catalog adds one background network call per day and two small tables.
