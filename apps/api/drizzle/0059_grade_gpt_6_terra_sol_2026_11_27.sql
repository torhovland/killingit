-- Grade the GPT-6.x models from the 2026-11-27 three-prompt benchmark.
--
-- Terra, Sol and GPT-6.2 Sol were re-run together on the current prompts so
-- the comparison is not contaminated by the prompt changes made after the
-- 2026-11-24 run (the goal ledger, completion targets and block format). The
-- dedicated benchmark key ran out of credits during the judge stage, so these
-- scores are the manual review against the same six-component rubric. The
-- per-prompt notes live in the run's judge-scores.json, which is local output.
--
-- All three models finish every prompt and the three season-revision gates
-- pass: Atlas is named, block one changes, and block one still starts
-- 2026-10-19.

-- 1. Write the measured grades and the manual review scores.
UPDATE "llm_models" AS m
SET
  "ability" = v."ability",
  "speed" = v."speed",
  "cost" = v."cost",
  "discouraged" = v."discouraged",
  "benchmark_score" = v."score",
  "benchmark_time_ms" = v."time_ms",
  "benchmark_cost_usd" = v."cost_usd",
  "benchmark_categories" = v."categories",
  "benchmarked_at" = v."benchmarked_at",
  "needs_rescore" = FALSE,
  "updated_at" = now()
FROM (VALUES
('openai/gpt-6.1-terra', 'A', 'B', 'B', FALSE, 10.4, 122995, 0.0881435, '{"design":2.2,"detail":1.6,"contract":1.4,"fidelity":1.5,"grounding":1.7,"rationale":1.7}'::jsonb, '2026-11-27T15:57:37.385Z'::timestamptz),
('openai/gpt-6.1-sol', 'A+', 'B', 'D', FALSE, 11, 146424, 0.173087, '{"design":2.4,"detail":1.7,"contract":1.5,"fidelity":1.5,"grounding":1.7,"rationale":1.8}'::jsonb, '2026-11-27T15:57:37.408Z'::timestamptz),
('openai/gpt-6.2-sol', 'A', 'B', 'D', FALSE, 10.5, 176010, 0.17013699999999998, '{"design":2.3,"detail":1.7,"contract":1.3,"fidelity":1.1,"grounding":1.7,"rationale":1.7}'::jsonb, '2026-11-27T15:57:37.411Z'::timestamptz)
) AS v("id", "ability", "speed", "cost", "discouraged", "score", "time_ms", "cost_usd", "categories", "benchmarked_at")
WHERE m."id" = v."id";

-- 2. Copy the freshly graded targets onto their aliases.
UPDATE "llm_models" AS a
SET
  "ability" = t."ability",
  "speed" = t."speed",
  "cost" = t."cost",
  "discouraged" = t."discouraged",
  "benchmark_score" = t."benchmark_score",
  "benchmark_time_ms" = t."benchmark_time_ms",
  "benchmark_cost_usd" = t."benchmark_cost_usd",
  "benchmark_categories" = t."benchmark_categories",
  "benchmarked_at" = t."benchmarked_at",
  "needs_rescore" = FALSE,
  "updated_at" = now()
FROM "llm_models" AS t
WHERE a."alias_target_slug" = t."id"
  AND t."id" IN ('openai/gpt-6.1-terra', 'openai/gpt-6.2-sol')
  AND t."benchmark_score" IS NOT NULL
  AND (
    a."ability" IS DISTINCT FROM t."ability"
    OR a."speed" IS DISTINCT FROM t."speed"
    OR a."cost" IS DISTINCT FROM t."cost"
    OR a."benchmark_score" IS DISTINCT FROM t."benchmark_score"
  );

-- 3. Recompute discouraged for the rows the benchmark touched.
UPDATE "llm_models"
SET
  "discouraged" = (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  ),
  "updated_at" = now()
WHERE "id" IN (
  'openai/gpt-6.1-terra',
  'openai/gpt-6.1-sol',
  'openai/gpt-6.2-sol',
  '~openai/gpt-terra-latest',
  '~openai/gpt-sol-latest'
)
  AND "discouraged" IS DISTINCT FROM (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  );
