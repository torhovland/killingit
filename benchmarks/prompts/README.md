# Prompts benchmark

This benchmark sends two prompts to every selected OpenRouter model and judges
both responses with `anthropic/claude-haiku-5.5`:

- `today-prompt.txt` — the single-day plan prompt for 2026-10-30.
- `revise-season-prompt.txt` — a drastic season revision on 2026-10-31 after
  the Atlas Mountain Race was added to the athlete's calendar.

Each model's score is the mean of its two judged scores (each out of 12.5), and
every component keeps the weaker of the two prompts, so a category failure in
either prompt grades the model F. Speed and cost are the sums of both prompt
runs, including retries.

The season revision also has three hard gates. Ability is F when a model:

1. never mentions `Atlas` anywhere in its output,
2. leaves block 1 unchanged, or
3. changes block 1's start date (it must stay `2026-10-26`).

The gates are checked mechanically against the current block supplied in the
prompt. The block comparison ignores the block name and rationale, and compares
the focus, end date and each week's start date, focus, target load and FTP
estimate.

## Re-running the benchmark

Run only models that still have `?` in ability or speed:

```sh
PENDING_ONLY=1 RUN_ID=2026-11-15-pending bun benchmarks/prompts/run.ts
RUN_ID=2026-11-15-pending bun benchmarks/prompts/judge.ts
RUN_ID=2026-11-15-pending bun benchmarks/prompts/sync-db.ts
```

`run.ts` reads `pendingBenchmarkModelIds()` from the database, so new,
ungraded, price-changed and alias-reassigned models are picked up automatically.
If an alias and its target both need grading, only the target is run; the alias
is copied from the finished target afterwards.

To re-score only models that already reached a grade — for example after a new
prompt is added — use `RESCORE_MIN_ABILITY`:

```sh
RESCORE_MIN_ABILITY=A RUN_ID=2026-11-01-rescore-a bun benchmarks/prompts/run.ts
```

This keeps models graded A or A+ plus every ungraded model; models graded below
A (B to F) are dropped. Add `DRY_RUN=1` to write `models.json` and exit without
calling any model. `:batch` variants are excluded because they are batch-only
and cannot be called through the synchronous chat-completions endpoint; `:free`
variants are included.

`sync-db.ts` refreshes the catalog, records the scores, and recomputes Ability,
Speed, Cost and Discouraged. The commands need the same `DATABASE_URL` and
`OPENROUTER_API_KEY` as the API.

A full run is the same sequence without a filter and with a fresh `RUN_ID`. The
HTML report is generated with:

```sh
SCORES_FILE=judge-scores.json USE_OVERRIDES=0 bun benchmarks/prompts/report.ts
```

## Completing an interrupted run

Provider credit limits, rate limits or a timeout can leave some prompts
unfinished. The stages can resume without re-calling prompts that already have
a valid answer:

```sh
# Retry only the prompts that are still unfinished, cheapest models first.
RETRY_FAILED=1 CONCURRENCY=2 RUN_ID=... bun benchmarks/prompts/run.ts

# Judge only models that finished both prompts; re-judge empty judge responses.
ONLY_VALID=1 RETRY_FAILED_JUDGES=1 RUN_ID=... bun benchmarks/prompts/judge.ts

# Record finished models only and leave the rest at their previous grade.
SKIP_FAILED=1 SKIP_REFRESH=1 RUN_ID=... bun benchmarks/prompts/sync-db.ts
```

`RETRY_FAILED=1` merges the new attempt into the existing prompt result, so the
recorded time and cost still cover every attempt. `RETRY_FAILED_JUDGES=1`
replaces a judge entry whose Haiku call returned an empty or unusable response.
`SKIP_FAILED=1` is deliberate: infrastructure failures must not turn a model
into an F.
