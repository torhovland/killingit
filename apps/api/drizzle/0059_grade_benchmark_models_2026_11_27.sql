-- Grade the nine-model catalog benchmark run from 2026-11-27.
--
-- GPT-6.1 Terra, GPT-6.1 Sol, GPT-6.2 Sol, Claude Sonnet 5.5, Claude Opus 5.5,
-- Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen and Gemini 4 Neon were run
-- together on the current three-prompt benchmark, so the comparison is not
-- contaminated by the prompt changes made after the 2026-11-24 run (the goal
-- ledger, completion targets and block format).
--
-- Scores are from anthropic/claude-opus-5.5 with three judge passes. Opus 5.5
-- is also a candidate, so compare its score with that self-judging caveat in
-- mind. Sonnet 5.5 returned no valid goal-steering response because every week
-- session omitted the required estimatedCaloriesKcal field, so it is recorded
-- as F. Opus and Sonnet needed the 4,096-token rescue attempt for the season
-- revision; their measured speed therefore includes those retries.

-- 1. Write the measured grades and the judge scores.
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
('anthropic/claude-opus-5.5', 'A', 'E', 'E', FALSE, 10.5, 558959, 0.580004, '{"design":2.5,"detail":1.6,"contract":1.4,"fidelity":1.6,"grounding":1.4,"rationale":1.4}'::jsonb, '2026-11-27T18:48:54.947Z'::timestamptz),
('openai/gpt-6.1-sol', 'B', 'B', 'D', FALSE, 10.1, 150649, 0.177887, '{"design":2.4,"detail":1.4,"contract":1.3,"fidelity":1.3,"grounding":1.4,"rationale":1.6}'::jsonb, '2026-11-27T18:48:54.953Z'::timestamptz),
('google/gemini-4-carbon', 'B', 'B', 'D', FALSE, 9.9, 170738, 0.194256, '{"design":2.2,"detail":1.5,"contract":1.3,"fidelity":1.6,"grounding":1.3,"rationale":1.3}'::jsonb, '2026-11-27T18:48:54.949Z'::timestamptz),
('google/gemini-4-argon', 'B', 'B', 'D', FALSE, 9.8, 163294, 0.193426, '{"design":2.2,"detail":1.5,"contract":1.2,"fidelity":1.5,"grounding":1.4,"rationale":1.2}'::jsonb, '2026-11-27T18:48:54.881Z'::timestamptz),
('google/gemini-4-neon', 'C', 'B', 'E', TRUE, 9.4, 164109, 0.388617, '{"design":1.8,"detail":1.3,"contract":1.3,"fidelity":1.5,"grounding":1.3,"rationale":1.1}'::jsonb, '2026-11-27T18:48:54.954Z'::timestamptz),
('openai/gpt-6.2-sol', 'D', 'B', 'D', TRUE, 9.3, 132107, 0.172087, '{"design":1,"detail":1.2,"contract":1.3,"fidelity":1.4,"grounding":1.3,"rationale":1.5}'::jsonb, '2026-11-27T18:48:54.958Z'::timestamptz),
('openai/gpt-6.1-terra', 'E', 'A', 'B', TRUE, 8.9, 112144, 0.0878335, '{"design":1,"detail":1,"contract":1.3,"fidelity":1.5,"grounding":1.2,"rationale":1.4}'::jsonb, '2026-11-27T18:48:54.956Z'::timestamptz),
('google/gemini-4-hydrogen', 'E', 'A', 'D', TRUE, 7.5, 103275, 0.171777, '{"design":0.9,"detail":0.8,"contract":1.3,"fidelity":0.5,"grounding":1.1,"rationale":0.6}'::jsonb, '2026-11-27T18:48:54.951Z'::timestamptz),
('anthropic/claude-sonnet-5.5', 'F', 'E', 'D', TRUE, 0, 484108, 0.286122, NULL::jsonb, '2026-11-27T18:48:54.945Z'::timestamptz)
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
  AND t."id" IN (
    'openai/gpt-6.1-terra',
    'openai/gpt-6.2-sol',
    'anthropic/claude-opus-5.5',
    'anthropic/claude-sonnet-5.5',
    'google/gemini-4-carbon',
    'google/gemini-4-hydrogen'
  )
  AND t."benchmark_score" IS NOT NULL
  AND (
    a."ability" IS DISTINCT FROM t."ability"
    OR a."speed" IS DISTINCT FROM t."speed"
    OR a."cost" IS DISTINCT FROM t."cost"
    OR a."benchmark_score" IS DISTINCT FROM t."benchmark_score"
  );

-- 3. Recompute discouraged for the rows and aliases the benchmark touched.
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
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-opus-5.5',
  'google/gemini-4-carbon',
  'google/gemini-4-argon',
  'google/gemini-4-hydrogen',
  'google/gemini-4-neon',
  '~openai/gpt-terra-latest',
  '~openai/gpt-sol-latest',
  '~anthropic/claude-opus-latest',
  '~anthropic/claude-sonnet-latest',
  '~google/gemini-pro-latest',
  '~google/gemini-flash-latest'
)
  AND "discouraged" IS DISTINCT FROM (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  );
