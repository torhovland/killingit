# LLM coach benchmarks

This directory keeps model comparisons produced by
`bun run benchmark:llm`. See `docs/specs/llm-benchmark.md` for the method and the
quality rubric.

## Runs

- `runs/2026-10-25T22-50-13-000Z-initial-16-model/` — the initial 16-model
  comparison. It used the old 4,096-token budget, so several reasoning models
  were truncated; see its report for the caveat. Benchmark: Claude Opus 5.5.
- `runs/2026-10-26-gemini-4-argon/` — the budget-increased run. Benchmark:
  Gemini 4 Argon. Models: Gemini 4 Argon, Claude Opus 5.5, GLM 5.3, GLM 5.3
  Prime, DeepSeek V4.1 Flash, Flint (free), DeepSeek V4 Pro.
- `runs/2026-10-27-six-model/` — a six-model follow-up at the 16,384-token
  budget. Benchmark: Gemini 4 Argon. Models: Gemini 4 Argon, Claude Haiku 5.5,
  DeepSeek V4.1 Flash, Mercury 3, MiniMax M3.1 Flash, GLM 5.3. Mercury 3 failed
  schema validation, so the run records its cost and error instead of a plan.
- `runs/2026-10-28-mercury-rerun/` — a single-model `inception/mercury-3`
  rerun after that failure. It produced a complete plan.
- `runs/2026-10-28-six-model-mercury-rerun/` — the same six models and budget
  as `2026-10-27-six-model`, with the successful Mercury 3 rerun in place of
  the failed attempt. The other five plans are unchanged from 27 October.

Each run lives in `runs/<run-id>/`:

```
runs/2026-10-26T12-00-00-000Z/
  metadata.json     # dates, model order, benchmark, git commit, budget
  results.json      # per-model cost, time, calls, usage and final plans
  plans/<model>.json
  scores.json       # optional human quality scores
  report.md         # generated table + plan snapshots + quality notes
```

The **first model in the list is the benchmark**. `results.json` and
`report.md` mark it; other models get cost/time ratios against it.

## Reports

`reports/` holds committed PDF summaries of the runs:

- `reports/2026-10-26-llm-plan-report.pdf` — the initial 16-model run and the
  budget-increased seven-model run together.
- `reports/2026-10-27-six-model-plan-report.pdf` — the 27 October six-model
  run, with Mercury 3's failed entry in place of a plan.
- `reports/2026-10-28-six-model-plan-report.pdf` — the six-model comparison
  with the successful Mercury 3 rerun.

## Reproducing a run

Use the same athlete context and the same `--today` / `--refresh-today` dates.
The runner reads the cached activity feed; sync the athlete in the app first if
new activities should be included.

```sh
export BENCHMARK_API_KEY=...   # or LLM_CREDENTIALS_KEY for the stored key
bun run benchmark:llm \
  google/gemini-4-argon \
  anthropic/claude-opus-5.5 \
  z-ai/glm-5.3 \
  z-ai/glm-5.3-prime \
  --today 2026-10-26 \
  --refresh-today 2026-11-02 \
  --run-id 2026-10-26-gemini-4-argon
```

## Quality scores

The runner measures cost and time; it cannot judge coaching. Write
`scores.json` after reading the plans, then regenerate the report:

```sh
bun run benchmark:llm --report-only benchmarks/llm-coach/runs/2026-10-26-gemini-4-argon
```

Score against the athlete's profile and constraints, not against other models in
the abstract. The first model is the reference point.

## What is excluded

- Weather and daylight (the benchmark has no saved location).
- The completed-week summary and post-build activity-review calls, which do not
  change the four plan levels.
- Anything written back to the athlete's stored plan: the runner uses in-memory
  plan stores.
