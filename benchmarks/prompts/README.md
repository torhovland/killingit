# Prompts benchmark

This benchmark sends three prompts to every selected OpenRouter model through
the app's `LlmProvider`:

- the daily-update prompt for 2026-10-30, which asks for today's session,
  tomorrow's session and the current week;
- the season-revision prompt for 2026-11-01 after the athlete set the Atlas
  Mountain Race on 28 February 2027 as the next goal; and
- the goal-steering refresh for 2027-07-04 from the full-season test, seven
  weeks before a 3:10 gravel race that is slipping away while the athlete
  completes every session and says they all feel easy.

The optional `judge` stage scores every response with
`anthropic/claude-haiku-5.5`. A single Haiku pass moves by more than a point
between runs, so a small comparison should set `JUDGE_PASSES=3` to average
three passes, or use a stronger judge such as
`JUDGE_MODEL=anthropic/claude-opus-5.5`. Both were run for the 2026-11-24
goal-steering comparison; the strong judge was markedly more stable.

Every prompt is built by the app's real prompt builders
(`buildDailyUpdateMessages` and `buildPlanUpdateMessages`) from fixture
athletes, so every rule, contract and context change reaches the benchmark
instead of leaving it on a frozen snapshot. The fixtures live in
`tools/benchmark/src/promptBenchmarkFixture.ts` and
`tools/benchmark/src/promptBenchmarkSeasonFixture.ts`, and the prompt
definitions in `tools/benchmark/src/promptBenchmarkInput.ts`. A snapshot test
pins the built input, so a prompt change fails `bun run test` until the snapshot
is deliberately updated:

```sh
bun run --filter @killingit/benchmark test --update-snapshots
```

Review the snapshot diff before committing it: it is the exact text every model
receives.

The whole harness — prompt builders, validators, score gates, catalog queries
and the run, judge, finalize, shortlist, sync-db and report stages — lives in
the `@killingit/benchmark` workspace (`tools/benchmark/src`). This directory
holds only the git-ignored run and report artifacts. See ADR 0032.

Each model's score is the mean of its three judged scores (each out of 12.5),
and every component keeps the weakest prompt, so a category failure in any
prompt caps the grade at C. Speed and cost are the sums of the two core app
prompt runs (today and season revision), including retries, so the extra
goal-steering ability call does not make a model look slower or more expensive
than the app sees it.

The ability bands were calibrated on the two core prompts. The goal-steering
task is newer and harder, so the three-prompt mean sits lower; compare raw
scores and relative order until a full catalog run recalibrates the bands. Do
not sync the catalog on the old bands after adding this prompt.

The season revision also has three hard gates. Ability is F when a model:

1. never mentions `Atlas` anywhere in its output,
2. leaves block 1 unchanged without asking a `coachQuestion` about Atlas, or
3. changes block 1's start date (it must stay `2026-10-19`).

The judge is told that an Atlas `coachQuestion` instead of an Atlas plan is
acceptable, but that it scores higher when the plan itself prepares for Atlas,
the first block changes to accommodate it, and no question is asked. A block
plan whose name, focus or rationale never mentions Atlas is a strong hint to the
judge that the revision is weak. The gates
are checked mechanically against the current block supplied in the prompt. The
block comparison ignores the block name and rationale, and compares the focus,
end date and each week's start date, focus, target load and FTP estimate.

The goal-steering prompt is judged against the harness's independent race
model: at about 247 W FTP, 3:10 on the 100 km course needs roughly 281 W in a
group. The judge rewards a candid statement that the goal is at risk or out of
reach from here, what is realistic, and a materially more ambitious safe block
that uses the athlete's stated 8-10 hours. A week that stays in the same
210-280 TSS range is treated as the timid prescription that created the problem.
There is no mechanical gate on this prompt: it is a coaching judgement, not a
keyword.

A model that reaches the speed-F limit (10 minutes across the two core prompts)
is stopped, skipped by the judge, and recorded with ability `?` rather than F, so
it stays ungraded instead of being labelled a failure. It is not asked the
goal-steering prompt.

## Re-running the benchmark

Run only models that still have `?` in ability or speed:

```sh
PENDING_ONLY=1 RUN_ID=2026-11-15-pending bun run benchmark:prompts run
RUN_ID=2026-11-15-pending bun run benchmark:prompts judge
RUN_ID=2026-11-15-pending bun run benchmark:prompts sync-db
```

The `run` stage reads `pendingBenchmarkModelIds()` from the database, so new,
ungraded, price-changed and alias-reassigned models are picked up automatically.
If an alias and its target both need grading, only the target is run; the alias
is copied from the finished target afterwards.

To re-score only models that already reached a grade — for example after a new
prompt is added — use `RESCORE_MIN_ABILITY`:

```sh
RESCORE_MIN_ABILITY=A RUN_ID=2026-11-01-rescore-a bun run benchmark:prompts run
```

This keeps models graded A or A+ plus every ungraded model; models graded below
A (B to F) are dropped. To re-score only models with one exact cost grade, set
`RESCORE_COST_GRADE`:

```sh
export BENCHMARK_OPENROUTER_API_KEY=...
RUN_ID=2026-11-01-cost-a-plus RESCORE_COST_GRADE=A+ bun run benchmark:prompts run
RUN_ID=2026-11-01-cost-a-plus bun run benchmark:prompts judge
RUN_ID=2026-11-01-cost-a-plus bun run benchmark:prompts sync-db
```

Unlike the ability filter, this keeps only models whose stored cost grade is
exactly the requested grade, so `A+` excludes A and every ungraded model. It
can be combined with `RESCORE_MIN_ABILITY`; aliases are skipped by either
filter and copied from their target after the target is graded. Add `DRY_RUN=1`
to write `models.json` and exit without calling any model. `:batch` variants
are excluded because they are batch-only and cannot be called through the
synchronous chat-completions endpoint; `:free` variants are included.

To select several cost grades and force extra models into the run, combine
`INCLUDE_COST_GRADES` and `INCLUDE_MODELS`:

```sh
RUN_ID=2026-11-01-above-a-plus \
INCLUDE_COST_GRADES=A,B,C \
INCLUDE_MODELS=elorian/glimpse,openai/gpt-5,perplexity/sonar-pro-search \
SORT=slowest \
bun run benchmark:prompts run
```

`INCLUDE_COST_GRADES` takes a comma-separated set of exact grades, and
`INCLUDE_MODELS` adds named IDs even when their cost grade is outside that set.
`EXCLUDE_ABILITY_GRADES` drops models with the listed current ability grades
(named models are kept), `SORT=slowest` orders the run by each model's previous
benchmark time, slowest first, and models with no previous time go last.
Aliases are never benchmarked directly: the `sync-db` stage copies every alias
from its target afterwards.

The `sync-db` stage refreshes the catalog, records the scores, and recomputes
Ability, Speed, Cost and Discouraged. The commands need the same `DATABASE_URL`
as the API and a dedicated `BENCHMARK_OPENROUTER_API_KEY`, so benchmark spend
stays separate from the app's per-account key.

A full run is the same sequence without a filter and with a fresh `RUN_ID`. The
HTML report is generated with:

```sh
RUN_ID=... SCORES_FILE=judge-scores.json USE_OVERRIDES=0 bun run benchmark:prompts report
```

The report shows each model's ability, speed and cost grades alongside its run
time, measured cost and judged score. The HTML report is written to
`benchmarks/prompts/reports/<RUN_ID>.html`. That directory is generated output
and is ignored by git, like the run directories; keep reports on disk and do not
commit them. Convert the HTML to PDF with a headless browser:

```sh
/usr/bin/chromium-browser --headless --no-sandbox --disable-gpu \
  --print-to-pdf=benchmarks/prompts/reports/<RUN_ID>.pdf \
  --print-to-pdf-no-header \
  "file://$PWD/benchmarks/prompts/reports/<RUN_ID>.html"
```

## Completing an interrupted run

Provider credit limits, rate limits or a timeout can leave some prompts
unfinished. The stages can resume without re-calling prompts that already have
a valid answer:

```sh
# Retry only the prompts that are still unfinished, cheapest models first.
RETRY_FAILED=1 CONCURRENCY=2 RUN_ID=... bun run benchmark:prompts run

# Judge only models that finished every prompt; re-judge empty judge responses.
ONLY_VALID=1 RETRY_FAILED_JUDGES=1 RUN_ID=... bun run benchmark:prompts judge

# Record finished models only and leave the rest at their previous grade.
SKIP_FAILED=1 SKIP_REFRESH=1 RUN_ID=... bun run benchmark:prompts sync-db
```

`RETRY_FAILED=1` merges the new attempt into the existing prompt result, so the
recorded time and cost still cover every attempt. `RETRY_FAILED_JUDGES=1`
replaces a judge entry whose Haiku call returned an empty or unusable response.
`SKIP_FAILED=1` is deliberate: infrastructure failures must not turn a model
into an F.
