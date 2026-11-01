-- Recompute discouraged under the rule that any known disqualifying grade is
-- enough. An ungraded (`?`) category does not disqualify on its own.
UPDATE "llm_models"
SET
  "discouraged" = (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  ),
  "updated_at" = now()
WHERE "discouraged" IS DISTINCT FROM (
  "ability" IN ('C', 'D', 'E', 'F')
  OR "speed" = 'F'
  OR "cost" = 'F'
);
