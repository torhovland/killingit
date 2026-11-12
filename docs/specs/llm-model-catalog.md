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
- `prompt_price_per_million`, `completion_price_per_million`, refreshed with
  the model list at most once every 24 hours
- benchmark score, time, cost, category breakdown and timestamp
- first/last seen timestamps

`llm_model_sync` stores the single most recent catalog check, its error, and the
24-hour gate.

### Grades

Ability:

- `A+` score >= 11.1
- `A` score >= 10.5
- `B` score >= 10.2 (below 10.5)
- `C` score >= 9.8 (below 10.2)
- `D` score >= 9.6 (below 9.8)
- `E` score > 0 (below 9.6)
- `F` failed, unscoreable, or any benchmark category below half its maximum

The category maxima are contract 1.5, fidelity 2, design 3, rationale 2,
grounding 2 and detail 2. The half-category rule overrides the score band, so a
model with a high total but a very weak category is still `F`.

Speed (the sum of both benchmark prompts, including retries):

- `A+` < 45 s, `A` < 90 s, `B` < 180 s, `C` < 300 s, `D` < 600 s, `E` < 1200 s,
  `F` >= 1200 s.

Cost (the measured cost of both benchmark prompts):

- `A+` < $0.015, `A` < $0.04, `B` < $0.10, `C` < $0.15, `D` < $0.35,
  `E` < $2.50, `F` >= $2.50.

The cost cuts are calibrated so the measured cost grades roughly match the
list-price grades: about 58% exact and 88% within one grade on the latest run,
with the same overall distribution.

Price grade (used before a model has been benchmarked):

- `?` when either list price is missing, negative or variable (routed models)
- `A+` prompt < $0.10/M and completion < $0.50/M
- `A` prompt < $0.32/M and completion < $1.60/M
- `B` prompt < $0.80/M and completion < $4.00/M
- `C` prompt < $2.00/M and completion < $10.00/M
- `D` prompt < $3.00/M and completion < $15.00/M
- `E` prompt < $20.00/M and completion < $100.00/M
- `F` prompt >= $20.00/M or completion >= $100.00/M

A model must satisfy both the prompt and completion limit for a band. The A-E
limits were chosen so those five bands are roughly equally populated across the
measured catalog; A+ and F are fixed product limits.

A model is `Discouraged` when ability is below `B`, speed is `F`, or cost is
`F`. Any known disqualifying grade is enough; an ungraded (`?`) category is
ignored rather than making the model safe.

### Refresh

On every signed-in page visit the web app calls
`POST /api/llm/models/refresh`. The API claims a single `llm_model_sync` row only
when the last check is more than 24 hours old, then fetches OpenRouter's model
list in the background.

- Existing models get their name, list price and `last_seen_at` refreshed.
- The prompt and completion prices are stored in USD per million tokens on
  every refresh, so the Settings data and price grades use current list prices.
- If a graded model's prompt or completion price changes, its cost grade is
  recalculated with the price grade and the model is marked `needsRescore` so
  the next pending benchmark run captures the real charged cost. The first
  pricing observation stores the price without treating it as a change.
- Alias models such as `~deepseek/deepseek-flash-latest` store OpenRouter's
  `alias_target.slug`. When that target changes, the alias is reset to
  ungraded, then immediately inherits the target's full benchmark: ability,
  speed, score, category data and measured cost grade. The alias keeps its own
  list prices for the price-grade column. If the target has no grade, the alias
  waits for the pending benchmark. Re-score runs never call an alias directly;
  they call the concrete target and force-copy its result afterwards.
- New models are inserted with `retired=false`, `discouraged=false`,
  `ability=?`, `speed=?`, and the price grade from their list prices.
- Models missing from OpenRouter are marked retired.
- OpenRouter's batch-only `:batch` routes are never inserted, and any existing
  `:batch` rows are deleted during the refresh. They are asynchronous and
  cannot serve normal chat requests.
- Existing benchmark grades are never overwritten by a refresh.

### Settings

`llm_settings` gains `season_model` and `daily_model`; the legacy `model` column
remains as the fallback. The Settings page shows one table of non-retired
models, plus any currently selected retired model with `(retired)` appended to
its name.

Columns are model, ability, speed, cost, discouraged and the two selection
radios, in that order; the season column is headed "Season plan". Admin
accounts also see a "Last scored" column with each model's `benchmarked_at`
time in their own time zone. Every grade column is sortable. Filters default
to:

- Include ungraded = true
- Include discouraged = false
- Ability = B or above
- Speed = D or above
- Cost = D or above

The filter bar shows the three grade dropdowns first, then Include ungraded,
then Include discouraged. Include ungraded only lets a `?` pass the grade it
belongs to; a model with a `?` ability but an E cost is still hidden when the
cost filter is B or above.

Sorting defaults to ability, then speed, then cost.

The season model is used for season plans, season refreshes and block planning.
The day model is used for week/day planning, coach questions, workout analysis,
metric reading, replies and every other daily prompt. Before a prompt runs, the
selected model is checked; a retired model fails with a message telling the
athlete to open Settings and choose another one. A discouraged model is still
allowed to run; Settings shows a danger warning below the table saying the model
is discouraged and that the athlete should choose another model first.

### Benchmark upkeep

The prompts benchmark runs two prompts per model: the single-day plan
(`today-prompt.txt`) and a drastic season revision (`revise-season-prompt.txt`).
Ability is F when a model never mentions Atlas, leaves block 1 unchanged, or
changes block 1's start date, and speed and cost are the sum of both prompt
runs. The definition, scoring and the catalog queries and grade writes the
benchmark needs live in the `@killingit/benchmark` workspace
(`tools/benchmark/src/promptBenchmark.ts` and `catalogBenchmark.ts`); the
runtime `modelCatalog.ts` keeps the refresh, the pure grading helpers and the
catalog rows the API serves. See ADR 0032.

The benchmark can run only the models that still have `?` in ability or speed:

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
included. Set `RESCORE_COST_GRADE` (for example `RESCORE_COST_GRADE=A+`) to keep
only models whose stored cost grade is exactly that grade, so ungraded models
are excluded; the two filters can be combined. `INCLUDE_COST_GRADES=A,B,C`
selects several exact cost grades, `INCLUDE_MODELS=id1,id2` forces named models
into the run even when their cost grade is excluded, `EXCLUDE_ABILITY_GRADES=F`
drops models with that current ability grade (named models are kept), and
`SORT=slowest` orders the run by previous benchmark time, slowest first.
Aliases are always skipped and copied from their target by `sync-db.ts`.
`:batch` variants are excluded
because they are asynchronous and cannot be called through the synchronous
endpoint. `DRY_RUN=1` writes the selection to `models.json` without calling any
model. The benchmark scripts use `BENCHMARK_OPENROUTER_API_KEY`, a dedicated
key separate from the app's per-account key.

A model that reaches the speed-F limit (`1_200_000` ms across both prompts) is
stopped and recorded with ability `?` instead of F. It is skipped by the judge
and remains ungraded, so a timeout never labels a model as an ability failure.
The season-revision gate also accepts a `coachQuestion` about Atlas in place of
a changed block 1; the judge still rewards the preferred full Atlas replan. A
block plan whose name, focus or rationale never mentions Atlas is treated by
the judge as a strong hint that the revision is weak.

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
5. A retired selection is refused with a Settings-page message. A discouraged
   selection is allowed and shows a danger warning below the models table.
6. The benchmark can run only ungraded models and write their grades back.
7. The benchmark tests each model at the today prompt and the season-revision
   prompt, sums their time and cost, and grades ability F when the revision
   omits Atlas, leaves block 1 unchanged, or moves block 1's start date.
8. The catalog stores prompt and completion list prices, refreshes them no more
   than once every 24 hours, and gives an unbenchmarked model a price grade
   instead of `?` unless its price is variable.
