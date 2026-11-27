-- Grade the models re-benchmarked on 2026-11-27.
--
-- Two runs share this migration:
--   1. the nine-model comparison judged by anthropic/claude-opus-5.5 (3 passes);
--   2. every active, non-alias model with ability B or better or unknown, speed
--      C or better or unknown, and cost B or better, judged by
--      openai/gpt-6.1-terra (3 passes).
--
-- The second run covers the cheap end of the catalog. Its judge is Terra, not
-- Opus, so its scores are not directly comparable with the nine-model run.
-- Models that could not return all three valid prompts are recorded as F with
-- a zero score; their gate failures and provider errors are in the local run
-- output.
--
-- Opus and Sonnet needed the 4,096-token rescue attempt for the season
-- revision, so their measured speed includes those retries.

-- 1. Write the measured grades and judge scores.
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
('anthropic/claude-opus-5.5', 'A', 'E', 'E', FALSE, 10.5, 558959, 0.580004, '{"design": 2.5, "detail": 1.6, "contract": 1.4, "fidelity": 1.6, "grounding": 1.4, "rationale": 1.4}'::jsonb, '2026-11-27 18:48:54.947+00'::timestamptz),
('anthropic/claude-sonnet-5.5', 'F', 'E', 'D', TRUE, 0, 484108, 0.286122, NULL::jsonb, '2026-11-27 18:48:54.945+00'::timestamptz),
('baidu/ernie-5.5-flash-preview:free', 'E', 'A', 'A+', TRUE, 7.3, 88519, 0, '{"design": 1.1, "detail": 0.7, "contract": 1.2, "fidelity": 0.8, "grounding": 1.1, "rationale": 0.2}'::jsonb, '2026-11-27 22:24:47.164+00'::timestamptz),
('deepseek/deepseek-v4.1-flash', 'E', 'B', 'A+', TRUE, 7.3, 140203, 0.0054479178, '{"design": 0.8, "detail": 0.5, "contract": 1, "fidelity": 0.5, "grounding": 0.6, "rationale": 0.4}'::jsonb, '2026-11-27 22:24:47.242+00'::timestamptz),
('google/gemini-3.8-flash', 'E', 'A+', 'B', TRUE, 7.5, 55274, 0.05978475, '{"design": 0.9, "detail": 0.9, "contract": 1.3, "fidelity": 1.3, "grounding": 1.2, "rationale": 0.4}'::jsonb, '2026-11-27 22:24:47.246+00'::timestamptz),
('google/gemini-4-argon', 'B', 'B', 'D', FALSE, 9.8, 163294, 0.193426, '{"design": 2.2, "detail": 1.5, "contract": 1.2, "fidelity": 1.5, "grounding": 1.4, "rationale": 1.2}'::jsonb, '2026-11-27 18:48:54.881+00'::timestamptz),
('google/gemini-4-carbon', 'B', 'B', 'D', FALSE, 9.9, 170738, 0.194256, '{"design": 2.2, "detail": 1.5, "contract": 1.3, "fidelity": 1.6, "grounding": 1.3, "rationale": 1.3}'::jsonb, '2026-11-27 18:48:54.949+00'::timestamptz),
('google/gemini-4-hydrogen', 'E', 'A', 'D', TRUE, 7.5, 103275, 0.171777, '{"design": 0.9, "detail": 0.8, "contract": 1.3, "fidelity": 0.5, "grounding": 1.1, "rationale": 0.6}'::jsonb, '2026-11-27 18:48:54.951+00'::timestamptz),
('google/gemini-4-neon', 'C', 'B', 'E', TRUE, 9.4, 164109, 0.388617, '{"design": 1.8, "detail": 1.3, "contract": 1.3, "fidelity": 1.5, "grounding": 1.3, "rationale": 1.1}'::jsonb, '2026-11-27 18:48:54.954+00'::timestamptz),
('inclusionai/ling-3.0-tiny', 'F', 'E', 'A+', TRUE, 0, 480046, 0, NULL::jsonb, '2026-11-27 22:24:47.307+00'::timestamptz),
('inclusionai/lingsante-3.1-air-vl', 'F', 'E', 'A+', TRUE, 0, 582917, 0.004013028, NULL::jsonb, '2026-11-27 22:24:47.308+00'::timestamptz),
('kt/midm-k-3.0-pro', 'F', 'A+', 'A', TRUE, 0, 34336, 0.018386800000000002, NULL::jsonb, '2026-11-27 22:24:47.263+00'::timestamptz),
('liquid/lfm-3-1.7b', 'F', 'A', 'A+', TRUE, 0, 97365, 0, NULL::jsonb, '2026-11-27 22:24:47.269+00'::timestamptz),
('liquid/lfm-3-1.7b:free', 'F', 'B', 'A+', TRUE, 0, 134934, 0, NULL::jsonb, '2026-11-27 22:24:47.273+00'::timestamptz),
('meta/muse-ember', 'E', 'A+', 'A+', TRUE, 6.7, 18015, 0.006860852, '{"design": 0.6, "detail": 0.4, "contract": 1.3, "fidelity": 0.4, "grounding": 0.6, "rationale": 0.7}'::jsonb, '2026-11-27 22:24:47.25+00'::timestamptz),
('meta/muse-spark-1.1', 'E', 'A+', 'B', TRUE, 6.7, 37003, 0.08962424999999999, '{"design": 1, "detail": 0.6, "contract": 1.2, "fidelity": 0.5, "grounding": 0.6, "rationale": 0.6}'::jsonb, '2026-11-27 22:24:47.259+00'::timestamptz),
('minimax/minimax-m3.1-flash', 'E', 'A+', 'A+', TRUE, 7.5, 27424, 0.008177775, '{"design": 0.7, "detail": 0.6, "contract": 1.2, "fidelity": 0.7, "grounding": 1, "rationale": 0.7}'::jsonb, '2026-11-27 22:24:47.254+00'::timestamptz),
('moonshotai/kimi-k2.7-code', 'F', 'E', 'B', TRUE, 0, 600000, 0.05984955, NULL::jsonb, '2026-11-27 22:24:47.302+00'::timestamptz),
('motif-technologies/motif-3', 'F', 'D', 'A', TRUE, 0, 255218, 0.0264516, NULL::jsonb, '2026-11-27 22:24:47.279+00'::timestamptz),
('nex-agi/nex-n2.6', 'F', 'E', 'A+', TRUE, 0, 429423, 0, NULL::jsonb, '2026-11-27 22:24:47.299+00'::timestamptz),
('openai/gpt-6-sol', 'C', 'A', 'D', TRUE, 9.5, 60213, 0.179897, '{"design": 1.8, "detail": 0.9, "contract": 1.5, "fidelity": 1.2, "grounding": 1.3, "rationale": 1.2}'::jsonb, '2026-11-27 22:24:47.271+00'::timestamptz),
('openai/gpt-6.1-sol', 'B', 'B', 'D', FALSE, 10.1, 150649, 0.177887, '{"design": 2.4, "detail": 1.4, "contract": 1.3, "fidelity": 1.3, "grounding": 1.4, "rationale": 1.6}'::jsonb, '2026-11-27 18:48:54.953+00'::timestamptz),
('openai/gpt-6.1-terra', 'E', 'A', 'B', TRUE, 8.9, 112144, 0.0878335, '{"design": 1, "detail": 1, "contract": 1.3, "fidelity": 1.5, "grounding": 1.2, "rationale": 1.4}'::jsonb, '2026-11-27 18:48:54.956+00'::timestamptz),
('openai/gpt-6.2-sol', 'D', 'B', 'D', TRUE, 9.3, 132107, 0.172087, '{"design": 1, "detail": 1.2, "contract": 1.3, "fidelity": 1.4, "grounding": 1.3, "rationale": 1.5}'::jsonb, '2026-11-27 18:48:54.958+00'::timestamptz),
('openrouter/auto-beta', 'D', 'C', 'D', TRUE, 9.3, 218088, 0.1703578, '{"design": 1.7, "detail": 0.9, "contract": 1, "fidelity": 1.5, "grounding": 1.5, "rationale": 1.1}'::jsonb, '2026-11-27 22:24:47.295+00'::timestamptz),
('particle-ai/particle-1:free', 'E', 'B', 'A+', TRUE, 6.9, 121633, 0, '{"design": 1, "detail": 0.5, "contract": 0.9, "fidelity": 0.6, "grounding": 0.6, "rationale": 0.5}'::jsonb, '2026-11-27 22:24:47.277+00'::timestamptz),
('radixark/daisyrose-27b', 'F', 'B', 'A', TRUE, 0, 142676, 0.033965625, NULL::jsonb, '2026-11-27 22:24:47.281+00'::timestamptz),
('ricursiveai/ripple-65b-preview', 'E', 'C', 'A+', TRUE, 4.1, 239083, 0.0032784999999999997, '{"design": 0.4, "detail": 0.4, "contract": 0.8, "fidelity": 0.5, "grounding": 0.4, "rationale": 0.2}'::jsonb, '2026-11-27 22:24:47.289+00'::timestamptz),
('tencent/hy4', 'F', 'E', 'B', TRUE, 0, 371310, 0.048171126, NULL::jsonb, '2026-11-27 22:24:47.304+00'::timestamptz),
('thinkingmachines/inkling-2-small', 'E', 'A', 'A', TRUE, 6.1, 61767, 0.016827599999999998, '{"design": 0.7, "detail": 0.5, "contract": 1.1, "fidelity": 0.4, "grounding": 0.7, "rationale": 0.5}'::jsonb, '2026-11-27 22:24:47.283+00'::timestamptz),
('upstage/solar-mini-4-5', 'F', 'A+', 'A+', TRUE, 0, 13569, 0.00065813, NULL::jsonb, '2026-11-27 22:24:47.286+00'::timestamptz),
('upstage/solar-pro-4-contributor', 'F', 'A+', 'A+', TRUE, 0, 49096, 0.00675981, NULL::jsonb, '2026-11-27 22:24:47.287+00'::timestamptz),
('x-ai/grok-4.5', 'E', 'A', 'C', TRUE, 6.7, 82125, 0.1184132, '{"design": 0.7, "detail": 0.6, "contract": 1.1, "fidelity": 0.7, "grounding": 0.9, "rationale": 0.7}'::jsonb, '2026-11-27 22:24:47.293+00'::timestamptz),
('xiaomi/mimo-v2.6-flash-mopd', 'F', 'A+', 'A', TRUE, 0, 50710, 0.024371, NULL::jsonb, '2026-11-27 22:24:47.291+00'::timestamptz),
('z-ai/glm-5.3-flashx-legal', 'E', 'A', 'A', TRUE, 5.9, 65761, 0.027998590000000004, '{"design": 0.9, "detail": 0.5, "contract": 0.8, "fidelity": 0.5, "grounding": 0.5, "rationale": 0.6}'::jsonb, '2026-11-27 22:24:47.297+00'::timestamptz)
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
    'anthropic/claude-opus-5.5',
    'anthropic/claude-sonnet-5.5',
    'google/gemini-4-carbon',
    'google/gemini-4-hydrogen',
    'openai/gpt-6.1-terra',
    'openai/gpt-6.2-sol'
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
  'anthropic/claude-opus-5.5',
  'anthropic/claude-sonnet-5.5',
  'baidu/ernie-5.5-flash-preview:free',
  'deepseek/deepseek-v4.1-flash',
  'google/gemini-3.8-flash',
  'google/gemini-4-argon',
  'google/gemini-4-carbon',
  'google/gemini-4-hydrogen',
  'google/gemini-4-neon',
  'inclusionai/ling-3.0-tiny',
  'inclusionai/lingsante-3.1-air-vl',
  'kt/midm-k-3.0-pro',
  'liquid/lfm-3-1.7b',
  'liquid/lfm-3-1.7b:free',
  'meta/muse-ember',
  'meta/muse-spark-1.1',
  'minimax/minimax-m3.1-flash',
  'moonshotai/kimi-k2.7-code',
  'motif-technologies/motif-3',
  'nex-agi/nex-n2.6',
  'openai/gpt-6-sol',
  'openai/gpt-6.1-sol',
  'openai/gpt-6.1-terra',
  'openai/gpt-6.2-sol',
  'openrouter/auto-beta',
  'particle-ai/particle-1:free',
  'radixark/daisyrose-27b',
  'ricursiveai/ripple-65b-preview',
  'tencent/hy4',
  'thinkingmachines/inkling-2-small',
  'upstage/solar-mini-4-5',
  'upstage/solar-pro-4-contributor',
  'x-ai/grok-4.5',
  'xiaomi/mimo-v2.6-flash-mopd',
  'z-ai/glm-5.3-flashx-legal',
  '~anthropic/claude-opus-latest',
  '~anthropic/claude-sonnet-latest',
  '~google/gemini-pro-latest',
  '~google/gemini-flash-latest',
  '~openai/gpt-terra-latest',
  '~openai/gpt-sol-latest'
)
  AND "discouraged" IS DISTINCT FROM (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  );
