# ADR 0016: Graded model catalog and split season/day model choices

## Context

The Settings page asked athletes to type an OpenRouter model id. That made a
typo look like a coaching failure, hid how expensive or slow a model was, and
gave every prompt the same model even though season planning and day-to-day
replies have different cost, latency and reasoning needs. OpenRouter's catalog
also changes without notice.

## Decision

Store every OpenRouter model in `llm_models` with retired/discouraged flags and
ability, speed and cost grades derived from the prompts benchmark. The benchmark
runs three prompts per model: a single-day plan, a drastic season revision and a
goal-steering refresh from the full-season goal test. Ability is the mean of all
three, while speed and cost stay the sum of the two core app prompts. Ability is
F when the revision omits Atlas, leaves block 1 unchanged, or changes block 1's
start date. Refresh the catalog in the
background on a page visit, at most once every 24 hours, and mark models missing
from OpenRouter as retired.

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

## Amendment (2026-11-28)

The daily-update prompt was removed from the catalog benchmark because it did
not separate models beyond the season revision and goal steering. The benchmark
now runs two prompts. Ability is the mean of those two scores, with bands A+ at
least 10.5, A at least 10.0, B at least 9.5, C at least 9.0, D at least 8.5, E
above zero and F for a failed run. Speed and cost are measured on the revision
prompt alone. The per-category cap was removed so a weak component cannot
override the score band. A catalog refresh now deletes models that are missing
from OpenRouter's list instead of marking them retired.
