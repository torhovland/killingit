# Today-prompt benchmark

This benchmark sends the single-day prompt in `prompt.txt` to every OpenRouter
model, judges each valid JSON response with `anthropic/claude-haiku-5.5`, and
writes the graded results into the app's `llm_models` catalog.

## Re-running the benchmark

Run only models that still have `?` in ability or speed:

```sh
PENDING_ONLY=1 RUN_ID=2026-11-15-pending bun benchmarks/today-prompt/run.ts
RUN_ID=2026-11-15-pending bun benchmarks/today-prompt/judge.ts
RUN_ID=2026-11-15-pending bun benchmarks/today-prompt/sync-db.ts
```

`run.ts` reads `pendingBenchmarkModelIds()` from the database, so new,
ungraded and price-changed models are picked up automatically. `sync-db.ts`
refreshes the catalog, records the scores, and recomputes Ability, Speed, Cost
and Discouraged.
The commands need the same `DATABASE_URL` and `OPENROUTER_API_KEY` as the API.

A full run is the same sequence without `PENDING_ONLY=1` and with a fresh
`RUN_ID`. The PDF report is generated with:

```sh
SCORES_FILE=judge-scores.json USE_OVERRIDES=0 bun benchmarks/today-prompt/report.ts
```
