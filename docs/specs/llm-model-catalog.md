# Spec: Graded OpenRouter model catalog and two-model coach settings

- **Status:** Accepted (implemented)
- **Date:** 2026-10-31
- **Related:** `docs/specs/openrouter-llm-integration.md`,
  `docs/specs/llm-benchmark.md`, ADR 0004, ADR 0016.

## Goal

Stop asking athletes to paste model IDs. Keep a graded catalog of every
OpenRouter model, let the athlete choose one model for season/block work and one
for day-to-day prompts, and keep the catalog current without blocking a visit.

## Scope

### Catalog table

`llm_models` stores one row per OpenRouter model:

- `id`, `name`
- `retired`, `discouraged`
- `ability`, `speed`, `cost`
- benchmark score, time, cost, category breakdown and timestamp
- first/last seen timestamps

`llm_model_sync` stores the single most recent catalog check, its error, and the
24-hour gate.

### Grades

Ability:

- `A+` score >= 11.1
- `A` score >= 10.5
- `B` score >= 9.0
- `C` score >= 8.0 (below 9)
- `D` score >= 7.5 (below 8)
- `E` score > 0 (below 7.5)
- `F` failed, unscoreable, or any benchmark category below half its maximum

The category maxima are contract 1.5, fidelity 2, design 3, rationale 2,
grounding 2 and detail 2. The half-category rule overrides the score band, so a
model with a high total but a very weak category is still `F`.

Speed:

- `A+` < 10 s, `A` < 20 s, `B` < 30 s, `C` < 45 s, `D` < 90 s, `E` < 150 s,
  `F` >= 150 s.

Cost:

- `A+` < $0.01, `A` < $0.05, `B` < $0.061, `C` < $0.077, `D` < $0.131,
  `E` < $0.30, `F` >= $0.30.

The B/C/D cost cuts are the 25th, 50th and 75th percentiles of the measured
benchmark costs between $0.05 and $0.30, so those bands stay roughly equal.

A model is `Discouraged` when ability is below `B`, speed is `F`, or cost is
`F`. An ungraded model is never discouraged until it has been benchmarked.

### Refresh

On every signed-in page visit the web app calls
`POST /api/llm/models/refresh`. The API claims a single `llm_model_sync` row only
when the last check is more than 24 hours old, then fetches OpenRouter's model
list in the background.

- Existing models get their name, list price and `last_seen_at` refreshed.
- If a graded model's prompt or completion price changes, its cost grade is
  recalculated from the new price and the model is marked `needsRescore` so the
  next pending benchmark run captures the real charged cost. The first pricing
  observation stores the price without treating it as a change.
- Alias models such as `~deepseek/deepseek-flash-latest` store OpenRouter's
  `alias_target.slug`. When that target changes, the alias is reset to
  ungraded, then immediately inherits the target's ability, speed, score and
  category data if the target is graded. Its cost grade still comes from the
  alias's own list price. If the target has no grade, the alias waits for the
  pending benchmark.
- New models are inserted with `retired=false`, `discouraged=false`,
  `ability=?`, `speed=?`, and a cost grade estimated from the list price.
- Models missing from OpenRouter are marked retired.
- Existing benchmark grades are never overwritten by a refresh.

### Settings

`llm_settings` gains `season_model` and `daily_model`; the legacy `model` column
remains as the fallback. The Settings page shows one table of non-retired
models, plus any currently selected retired model with `(retired)` appended to
its name.

Columns are model, discouraged, ability, speed, cost and the two selection
radios. Every column is sortable. Filters default to:

- Discouraged = false
- Ability = B or above
- Speed = D or above
- Cost = E or above

Sorting defaults to ability, then speed, then cost.

The season model is used for season plans, season refreshes and block planning.
The day model is used for week/day planning, coach questions, workout analysis,
metric reading, replies and every other daily prompt. Before a prompt runs, the
selected model is checked; a retired or discouraged model fails with a message
telling the athlete to open Settings and choose another one.

### Benchmark upkeep

The prompts benchmark runs two prompts per model: the single-day plan
(`today-prompt.txt`) and a drastic season revision (`revise-season-prompt.txt`).
Ability is F when a model never mentions Atlas, leaves block 1 unchanged, or
changes block 1's start date, and speed and cost are the sum of both prompt
runs. The benchmark can run only the models that still have `?` in ability or
speed:

```sh
# 1. Run the pending models into a fresh run directory
PENDING_ONLY=1 RUN_ID=2026-11-15-pending \
  bun benchmarks/prompts/run.ts

# 2. Judge both returned JSON documents with Haiku
RUN_ID=2026-11-15-pending bun benchmarks/prompts/judge.ts

# 3. Save the grades into llm_models
RUN_ID=2026-11-15-pending bun benchmarks/prompts/sync-db.ts
```

`pendingBenchmarkModelIds()` resolves alias dependencies before returning the
run list: if both an alias and the model it points at need grading, the alias is
left out and the concrete target is graded first. `sync-db.ts` refreshes the
catalog first, records every result in the run, copies the freshly graded
target onto its waiting aliases, and recomputes ability, speed, cost and
discouraged. It also clears `needs_rescore` for the models it graded. New
models, price-changed models and aliases whose target could not be copied are
picked up automatically.

To re-score only models that already reached a grade, set
`RESCORE_MIN_ABILITY` (for example `RESCORE_MIN_ABILITY=A`) on `run.ts`; models
graded below that grade are left untouched, while every ungraded model is still
included. `:batch` variants are excluded because they are asynchronous and
cannot be called through the synchronous endpoint. `DRY_RUN=1` writes the
selection to `models.json` without calling any model.

If a run is interrupted by a provider limit, `RETRY_FAILED=1` re-runs only the
unfinished prompts, `ONLY_VALID=1 RETRY_FAILED_JUDGES=1` judges the models that
finished both prompts, and `SKIP_FAILED=1 SKIP_REFRESH=1` records only those
models so an infrastructure failure is not written as a model failure.

## Acceptance criteria

1. The catalog table contains every OpenRouter model with the grade columns.
2. A catalog refresh runs at most once per 24 hours, inserts new models and
   retires missing ones.
3. The Settings page offers one sortable, filterable table and two radio
   selections, with the documented defaults.
4. Season/block prompts use `season_model`; week/day and day-to-day prompts use
   `daily_model`.
5. A retired or discouraged selection is refused with a Settings-page message.
6. The benchmark can run only ungraded models and write their grades back.
7. The benchmark tests each model at the today prompt and the season-revision
   prompt, sums their time and cost, and grades ability F when the revision
   omits Atlas, leaves block 1 unchanged, or moves block 1's start date.
