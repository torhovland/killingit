-- Re-grade existing B-E ability bands after the 2026-11-01 threshold change.
-- Only rows currently graded B-E are touched. F rows may be gate or category
-- failures, which cannot be distinguished from stored data, so they stay F.
WITH regraded AS (
  SELECT
    "id",
    "speed",
    "cost",
    CASE
      WHEN "benchmark_score" >= 10.2 THEN 'B'
      WHEN "benchmark_score" >= 9.8 THEN 'C'
      WHEN "benchmark_score" >= 9.6 THEN 'D'
      ELSE 'E'
    END AS new_ability
  FROM "llm_models"
  WHERE "ability" IN ('B', 'C', 'D', 'E')
    AND "benchmark_score" IS NOT NULL
    AND "benchmark_categories" IS NOT NULL
), changed AS (
  SELECT
    "id",
    new_ability,
    CASE
      WHEN new_ability = 'B' THEN ("speed" = 'F' OR "cost" = 'F')
      ELSE TRUE
    END AS new_discouraged
  FROM regraded
)
UPDATE "llm_models" AS m
SET
  "ability" = c.new_ability,
  "discouraged" = c.new_discouraged,
  "updated_at" = now()
FROM changed AS c
WHERE m."id" = c."id"
  AND (
    m."ability" IS DISTINCT FROM c.new_ability
    OR m."discouraged" IS DISTINCT FROM c.new_discouraged
  );
