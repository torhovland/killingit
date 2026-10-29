# Spec: LLM coach benchmark

- **Status:** Accepted (implemented)
- **Date:** 2026-10-26
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/openrouter-llm-integration.md`.

## Goal

Compare OpenRouter models on the app's real four-level plan generation and its
new-week refresh, using the same athlete profile, recent training and prompts.
The first model in the supplied list is the benchmark; every other model is
compared with its cost, time and plan quality.

## Scope

### In scope

1. A reusable runner at `apps/api/src/benchmark/` that:
   - loads an athlete's survey answers, cached activity feed, activity analyses,
     comments, weekly notes and completed-period reviews from the database;
   - runs the real `runPlanGeneration` full build for the supplied day;
   - runs the real new-week plan update for a Monday after that day, using the
     model's own full plan;
   - keeps plan stores in memory, so it never writes the athlete's stored plan;
   - records each OpenRouter completion's latency, tokens, finish reason and
     reported cost, including fallbacks and JSON repairs.
2. A CLI that accepts positional models or a models file and writes a
   source-controlled run directory.
3. A generated Markdown report with cost, time, call/truncation counts,
   benchmark-relative ratios and plan snapshots.
4. Optional manual quality scores (`scores.json`) included in the report.
5. Raising the plan input/output budget so reasoning models can finish:
   `PLAN_MAX_TOKENS = 16_384`, with fallback attempts up to 32,768 and a
   4,096-token compatibility attempt for providers that reject a large
   `max_tokens`.

### Out of scope

- Automatic judging of coaching quality. Quality is a human/agent assessment
  recorded in `scores.json` and the report.
- Weather/daylight-sensitive scenarios: the benchmark does not load a location
  so runs are independent of network weather providers.
- The completed-period summary and post-build activity-review calls. They do not
  change the four plan levels; their cost/time is therefore excluded.
- A scheduled CI job. Models cost money and need a live key; runs are explicit.

## Acceptance criteria

1. `bun run benchmark:llm google/gemini-4-argon anthropic/claude-opus-5.5`
   generates a full plan and a week+day refresh for both models, with Gemini
   marked as the benchmark.
2. A models file can be supplied with `--models-file`.
3. The first supplied model is the benchmark in `results.json` and
   `report.md`, regardless of later ordering.
4. Each run directory contains `metadata.json`, `results.json`, `plans/*.json`,
   `report.md`, and optionally `scores.json`.
5. The runner reads the athlete's real context but never writes plans back to
   `coach_plans`, `plan_generations`, `period_reviews` or `coach_replies`.
6. Costs come from OpenRouter's `usage.cost`; timings are wall-clock for the
   complete call chain.
7. The plan output budget is `16_384` tokens for every season/block/week/day
   attempt, with reasoning fallbacks up to `32_768` and a smaller compatibility
   attempt.
8. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Running

Prerequisites: a database with the athlete context and an OpenRouter key.

```sh
# Key supplied directly (preferred; never written to the run output).
export BENCHMARK_API_KEY=...

# Or let the runner decrypt the account's stored key.
export LLM_CREDENTIALS_KEY=...

bun run benchmark:llm \
  google/gemini-4-argon \
  anthropic/claude-opus-5.5 \
  z-ai/glm-5.3 \
  z-ai/glm-5.3-prime

# Same list from a file, with explicit dates and a named run.
bun run benchmark:llm --models-file models.txt \
  --today 2026-10-26 --refresh-today 2026-11-02 \
  --run-id 2026-10-26-gemini-benchmark
```

Configuration:

- `--user-id` — required only when the database has more than one account.
- `--today` — full-build day; defaults to today in UTC.
- `--refresh-today` — new-week day; defaults to the Monday after `--today`.
- `--output` — root directory; defaults to `benchmarks/llm-coach/runs`.
- `--run-id` — run directory name; defaults to a UTC timestamp.
- `--scores` — optional quality scores to include in the report.
- `--report-only <dir>` — rebuild `report.md` from an existing run without
  calling any model.

## Data and privacy

The runner stores the generated plans, not the survey answers or raw prompts.
Plans can still contain personal training details; treat the benchmark directory
as product data and review it before publishing. The API key is never serialized
to a run file.

## Quality assessment

Costs and timings are measured. Quality is assessed by reading the season,
block, week and day (and the refreshed week/day) against the athlete's profile,
constraints and recent training. A score is relative to the first model:

- 10 — expert-level, no material errors;
- 8–9 — strong, minor issues;
- 6–7 — usable, but notable judgment/grounding errors;
- 4–5 — a major omission or unsafe choice;
- 0–3 — unusable.

Scores live in `scores.json`:

```json
{
  "google/gemini-4-argon": {
    "quality": 9.5,
    "notes": "Full brevet series, PBP through the finish, honest refresh."
  }
}
```

`report.md` is regenerated with `--report-only` after the scores are written.
