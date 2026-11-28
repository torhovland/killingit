-- Grade the 2026-11-28 rerun of the two stale cost-C models.
--
-- Both were last graded on the old suite on 2026-11-01 and were not covered by
-- the pre-23-November ungrade in 0061. They were re-run on the current
-- two-prompt suite and judged by GPT-6.1 Terra with three passes.
--
-- Mistral Large 4.0 timed out on both prompts and is recorded as F. GPT-6.1
-- Terra Pro returned both prompts and lands at D.

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
('openai/gpt-6.1-terra-pro', 'D', 'A', 'C', TRUE, 8.8, 86514, 0.11971045, '{"design":1.7,"detail":0.9,"contract":1.2,"fidelity":1.3,"grounding":1.2,"rationale":1.2}'::jsonb, '2026-11-28T09:10:08.967Z'::timestamptz),
('mistralai/mistral-large-4-0', 'F', 'E', 'A+', TRUE, 0, 406034, 0, NULL::jsonb, '2026-11-28T09:10:09.001Z'::timestamptz)
) AS v("id", "ability", "speed", "cost", "discouraged", "score", "time_ms", "cost_usd", "categories", "benchmarked_at")
WHERE m."id" = v."id";

UPDATE "llm_models"
SET
  "discouraged" = (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  ),
  "updated_at" = now()
WHERE "id" IN ('openai/gpt-6.1-terra-pro', 'mistralai/mistral-large-4-0')
  AND "discouraged" IS DISTINCT FROM (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  );
