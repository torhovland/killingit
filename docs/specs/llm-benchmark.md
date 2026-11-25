# Spec: LLM coach benchmark

- **Status:** Accepted (implemented)
- **Date:** 2026-10-26
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/openrouter-llm-integration.md`.

## Goal

Compare OpenRouter models on the app's real coaching work. The workspace has two
modes that share one entry point, the app's `LlmProvider` and the app's prompt
builders:

- the **plan comparison** runs the real four-level plan generation and its
  new-week refresh for a list of models; and
- the **three-prompt catalog benchmark** sends the daily-update prompt, the
  season-revision prompt and the goal-steering prompt to every catalog model
  and grades them.

The first model in a plan-comparison run is the benchmark; every other model is
compared with its cost, time and plan quality. The catalog benchmark fills the
model catalog's ability, speed and cost grades.

## Scope

### In scope

1. A reusable runner in the `@killingit/benchmark` workspace at
   `tools/benchmark/src/` that:
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
6. A three-prompt mode with explicit `run`, `judge`, `finalize`, `shortlist`,
   `sync-db` and `report` stages. The run stage calls every prompt through the
   app's `LlmProvider`, judging is an optional stage, and the models are selected
   from the catalog or the environment exactly as before. Its prompt builders,
   validators, score gates, catalog queries and report renderer all live in the
   same workspace, so the mode is typechecked, linted and covered like the plan
   comparison instead of being an untyped root script.

### Out of scope

- Automatic judging of the **plan comparison's** plan quality. That mode's
  quality is a human/agent assessment recorded in `scores.json` and the report;
  the catalog benchmark has its own automatic `judge` stage.
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
9. The harness lives in the `tools/benchmark` workspace; `apps/api/src` keeps
   no benchmark CLI and no benchmark-only module. See ADR 0032.
10. `bun run benchmark:llm -- --help` and `bun run benchmark:prompts -- --help`
    both print their usage without a key, database or spend.
11. The catalog benchmark keeps its run artefacts under
    `benchmarks/prompts/runs/<RUN_ID>/` (`models.json`, `raw/*.json`,
    `results.json`, `judge-scores.json`) and its HTML report under
    `benchmarks/prompts/reports/<RUN_ID>.html`; both directories stay ignored.
12. Running the catalog benchmark through the plan comparison's `LlmProvider`
    keeps the recorded status, finish reason, usage, cost, raw text and parse
    error per attempt, so the existing judge, finalize, report and sync stages
    read a run unchanged.
13. Every run file a stage reads is parsed through the schema that describes it,
    so a renamed field or a corrupt file is reported with its path; `report`,
    `shortlist`, `sync-db` and `finalize` refuse an invalid input, while `run`
    and `judge` keep their current-shape resume filter. The exported types are
    `z.infer` of those schemas, so a type cannot drift from its file.

## Stored run files

`results.json`, `raw/*.json`, `judge-scores.json`, `sources.json`,
`overrides.json` and the plan comparison's `metadata.json`, `results.json` and
`scores.json` all have a fixed JSON shape. Each shape is a Zod schema in
`tools/benchmark/src/promptBenchmarkTypes.ts` (catalog benchmark) or
`tools/benchmark/src/types.ts` (plan comparison), and every exported type is
`z.infer` of its schema. Reads go through `readJsonFile` in
`tools/benchmark/src/jsonFile.ts`, which names the file and the offending field
when validation fails.

The resume stages need a partial file to be usable. A model's `prompts` record
is partial, so a run written before the goal-steering prompt existed still
parses: `run` reuses every stored prompt that is valid and calls only the
missing one. A model is skipped entirely only when all prompts have a valid
response, and `judge` requires all prompts because it cannot score a missing
answer. An entry written for the superseded flat results format is dropped, and
`readJsonEntries` applies the same schema per entry for that filter.
The other stages are strict, because the file is their whole input: a corrupt
`results.json` or `judge-scores.json` fails `report`, `shortlist`, `sync-db` and
`finalize` instead of rendering a table or recording a grade that a silent zero
would misrepresent. An ESLint rule bans `JSON.parse` in `tools/benchmark/src`
outside `jsonFile.ts`, the model-answer extractor and the outgoing-request
parser, so a new stage cannot go back to a hand-written cast. A unit test parses
every committed plan-comparison run, so a plan-shape change that would break
`--report-only` fails CI.

## Running

Prerequisites: a database with the athlete context and an OpenRouter key. Run
the commands from the repository root. The harness is the `@killingit/benchmark`
workspace, so it imports the real plan-generation pipeline from `apps/api`.

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

### Three-prompt catalog benchmark

The catalog benchmark stages read `BENCHMARK_OPENROUTER_API_KEY`, a dedicated key
separate from the plan comparison's `BENCHMARK_API_KEY`, so catalog spend stays
apart from the app's per-account key.

Run one stage at a time; `RUN_ID` names the run directory and every stage reads
it:

```sh
PENDING_ONLY=1 RUN_ID=2026-11-15-pending bun run benchmark:prompts run
RUN_ID=2026-11-15-pending bun run benchmark:prompts judge
RUN_ID=2026-11-15-pending bun run benchmark:prompts sync-db
RUN_ID=... bun run benchmark:prompts report
```

Every prompt uses the app's own plan budget and reasoning ladder:
`PLAN_MAX_TOKENS` with minimal reasoning, the same budget with reasoning off,
`MAX_COMPLETION_TOKENS` without reasoning control, and the
`RESCUE_COMPLETION_TOKENS` retry, all from `apps/api/src/llm/planBudget.ts` and
`attemptLadder` in `apps/api/src/llm/resilientCompletion.ts`. A smaller
benchmark ceiling or a missing reasoning control would let reasoning tokens
exhaust the budget and record a truncation as a coaching failure the app itself
would not produce.

The goal-steering prompt is built from the moment in the full-season test when
the 3:10 gravel goal is slipping: Sunday 2027-07-04, seven weeks before the
race, with a compliant athlete at about 247 W FTP and 31 CTL after a block that
only prescribed 215-280 TSS weeks and a weekly note saying every workout felt
easy. The judge is given the harness's independent course model as ground
truth, recognises that 3:10 needs about 281 W in a group, and rewards a candid
read of the gap plus a materially more ambitious safe block rather than another
timid week. It is the prompt that distinguishes a model which steers from one
that merely repeats the existing plan.

Ability is the mean of all three judged prompt scores. Speed and cost remain the
sum of the two core app prompts, so the extra ability call does not make a model
look slower or more expensive than the app sees it. The speed-F limit still
stops on the core prompts; a model that reaches it is not asked the
goal-steering prompt and stays ungraded.

The judge moves by more than a point between single passes, which is wider than
the gap between capable models. `JUDGE_PASSES=3` averages three passes per
prompt (the note comes from the pass closest to the mean), and a stronger
`JUDGE_MODEL` such as `anthropic/claude-opus-5.5` is materially more stable for
a small comparison. The default stays one Haiku pass because a full-catalog run
multiplies the judge spend by the number of passes.

The current ability bands were calibrated on the two core prompts. The
goal-steering task is newer and harder, so the three-prompt mean sits lower and
the absolute grade is not comparable until a full catalog run recalibrates the
bands. A run that adds the third prompt should compare raw scores and relative
order, and should not sync the catalog on the old bands.

`run` writes `models.json`, `raw/*.json` and `results.json`; `judge` is optional
and writes `judge-scores.json`; `finalize` recovers responses rejected only for
a warning-level contract issue; `shortlist` prints the top judged models;
`sync-db` refreshes the catalog and records the grades; and `report` renders the
HTML preview. The detailed model selection, resume and grading variables are in
`benchmarks/prompts/README.md` and `docs/specs/llm-model-catalog.md`.

## Artifact policy

`benchmarks/llm-coach/runs/` and its PDF summaries are source-controlled
snapshots. The catalog benchmark's output is not: `benchmarks/prompts/runs/`
and `benchmarks/prompts/reports/` are ignored by git, and the generated
`<RUN_ID>.html`/`.pdf` reports are local previews to regenerate rather than
commit. Its input is not a committed prompt file: every prompt is built by the
app's prompt builders from the fixture athletes in
`tools/benchmark/src/promptBenchmarkFixture.ts` and
`tools/benchmark/src/promptBenchmarkSeasonFixture.ts`, and a snapshot test pins
the text so a prompt change is reviewed rather than silently ignored. See
`benchmarks/README.md`.

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
