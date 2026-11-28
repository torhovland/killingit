-- Grade the 2026-11-28 C-or-better rerun.
--
-- Every model with cost C or better and ability C or better that was last
-- benchmarked before 23 November was rerun on the two-prompt suite: four
-- models. The judge is openai/gpt-6.1-terra with three passes.
--
-- None of them keeps a C ability. GPT-5.3 Codex lands at E; Muse Spark 1.3 is
-- E; Gemini 3.7 Flash fails the block-one gate; Mistral Medium 3.5 fails goal
-- steering and is F.

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
('google/gemini-3.7-flash', 'F', 'A+', 'A', TRUE, 5.4, 27161, 0.0362085, '{"design":0.9,"detail":0.5,"contract":1,"fidelity":0.6,"grounding":1,"rationale":0.4}'::jsonb, '2026-11-28T11:17:39.903Z'::timestamptz),
('meta/muse-spark-1.3', 'E', 'A+', 'B', TRUE, 6.4, 19951, 0.04425375, '{"design":0.9,"detail":0.5,"contract":1.1,"fidelity":0.5,"grounding":1.2,"rationale":0.5}'::jsonb, '2026-11-28T11:17:39.844Z'::timestamptz),
('mistralai/mistral-medium-3-5', 'F', 'A', 'B', TRUE, 0, 110089, 0.0786045, NULL::jsonb, '2026-11-28T11:17:39.908Z'::timestamptz),
('openai/gpt-5.3-codex', 'E', 'A+', 'C', TRUE, 7, 58585, 0.131523, '{"design":1.1,"detail":0.8,"contract":1.2,"fidelity":1,"grounding":1.2,"rationale":1}'::jsonb, '2026-11-28T11:17:39.905Z'::timestamptz)
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
WHERE "id" IN (
  'google/gemini-3.7-flash',
  'meta/muse-spark-1.3',
  'mistralai/mistral-medium-3-5',
  'openai/gpt-5.3-codex'
)
  AND "discouraged" IS DISTINCT FROM (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  );
