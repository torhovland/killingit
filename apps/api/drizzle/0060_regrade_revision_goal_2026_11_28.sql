-- Regrade the catalog on the two-prompt benchmark, 2026-11-28.
--
-- The Today prompt was removed: it did not separate models beyond the season
-- revision and goal steering. Ability is now the mean of those two scores and
-- uses these bands: A+ >= 10.5, A >= 10.0, B >= 9.5, C >= 9.0, D >= 8.5,
-- E > 0, F failed. Speed and cost are measured on the revision prompt alone.
--
-- This migration covers every model with both prompts from the three runs:
--   1. the nine-model comparison judged by Claude Opus 5.5;
--   2. the cheap filtered set judged by GPT-6.1 Terra;
--   3. the 2026-11-28 follow-up judged by Claude Opus 5.5.
-- The old three-prompt grades in 0059 are superseded for these rows. Scores
-- from different judges are not directly comparable; the run directories keep
-- the per-prompt evidence.
--
-- Models that failed a prompt are recorded as F with a zero score. The
-- per-prompt errors and gate failures live in each run's local output.

-- 1. Write the regraded rows.
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
('anthropic/claude-opus-5.5', 'A+', 'E', 'E', FALSE, 10.6, 509073, 0.381912, '{"design": 2.5, "detail": 1.6, "contract": 1.4, "fidelity": 1.7, "grounding": 1.4, "rationale": 1.4}'::jsonb, '2026-11-27 23:39:53.084+00'::timestamptz),
('anthropic/claude-sonnet-4.6', 'F', 'D', 'A+', TRUE, 0, 240000, 0, NULL::jsonb, '2026-11-27 23:40:53.553+00'::timestamptz),
('anthropic/claude-sonnet-5.5', 'F', 'E', 'D', TRUE, 0, 462164, 0.209446, NULL::jsonb, '2026-11-27 23:39:53.082+00'::timestamptz),
('baidu/ernie-5.5-flash-preview:free', 'E', 'A+', 'A+', TRUE, 6.7, 46791, 0, '{"design": 1.1, "detail": 0.7, "contract": 1.2, "fidelity": 0.8, "grounding": 1.1, "rationale": 0.2}'::jsonb, '2026-11-27 23:40:23.268+00'::timestamptz),
('deepseek/deepseek-v4.1-flash', 'E', 'A', 'A+', TRUE, 5.6, 73769, 0.0022812972, '{"design": 0.8, "detail": 0.5, "contract": 1, "fidelity": 0.5, "grounding": 0.6, "rationale": 0.4}'::jsonb, '2026-11-27 23:40:23.29+00'::timestamptz),
('fireworks/ember-1', 'D', 'A', 'D', TRUE, 8.5, 72978, 0.154536, '{"design": 1.3, "detail": 1, "contract": 1.3, "fidelity": 1, "grounding": 1.4, "rationale": 1}'::jsonb, '2026-11-27 23:40:53.536+00'::timestamptz),
('google/gemini-3.8-flash', 'E', 'A+', 'A', TRUE, 6.9, 40584, 0.0378435, '{"design": 0.9, "detail": 0.9, "contract": 1.3, "fidelity": 1.3, "grounding": 1.2, "rationale": 0.4}'::jsonb, '2026-11-27 23:40:23.292+00'::timestamptz),
('google/gemini-4-argon', 'B', 'A', 'C', FALSE, 9.9, 112531, 0.123554, '{"design": 2.3, "detail": 1.5, "contract": 1.2, "fidelity": 1.6, "grounding": 1.4, "rationale": 1.2}'::jsonb, '2026-11-27 23:39:53.055+00'::timestamptz),
('google/gemini-4-carbon', 'B', 'A', 'C', FALSE, 9.8, 107530, 0.128694, '{"design": 2.2, "detail": 1.5, "contract": 1.3, "fidelity": 1.6, "grounding": 1.3, "rationale": 1.3}'::jsonb, '2026-11-27 23:39:53.086+00'::timestamptz),
('google/gemini-4-hydrogen', 'E', 'A', 'C', TRUE, 6.9, 70379, 0.111123, '{"design": 0.9, "detail": 0.8, "contract": 1.3, "fidelity": 0.5, "grounding": 1.1, "rationale": 0.6}'::jsonb, '2026-11-27 23:39:53.088+00'::timestamptz),
('google/gemini-4-neon', 'C', 'A', 'D', TRUE, 9.2, 111447, 0.25194, '{"design": 1.8, "detail": 1.3, "contract": 1.3, "fidelity": 1.5, "grounding": 1.3, "rationale": 1.1}'::jsonb, '2026-11-27 23:39:53.091+00'::timestamptz),
('inclusionai/ling-3.0-tiny', 'F', 'D', 'A+', TRUE, 0, 240040, 0, NULL::jsonb, '2026-11-27 23:40:23.328+00'::timestamptz),
('inclusionai/ling-3.2-flash', 'F', 'A+', 'A+', TRUE, 0, 1405, 0, NULL::jsonb, '2026-11-27 23:40:53.508+00'::timestamptz),
('inclusionai/lingsante-3.1-air-vl', 'F', 'E', 'A+', TRUE, 0, 320014, 0.002470188, NULL::jsonb, '2026-11-27 23:40:23.329+00'::timestamptz),
('kt/midm-k-3.0-pro', 'F', 'A+', 'A+', TRUE, 0, 22316, 0.0117754, NULL::jsonb, '2026-11-27 23:40:23.299+00'::timestamptz),
('liquid/lfm-3-1.7b', 'F', 'A+', 'A+', TRUE, 0, 48536, 0, NULL::jsonb, '2026-11-27 23:40:23.301+00'::timestamptz),
('liquid/lfm-3-1.7b:free', 'F', 'A', 'A+', TRUE, 0, 66636, 0, NULL::jsonb, '2026-11-27 23:40:23.304+00'::timestamptz),
('meta/muse-ember', 'E', 'A+', 'A+', TRUE, 6.2, 10811, 0.004064452, '{"design": 0.6, "detail": 0.4, "contract": 1.3, "fidelity": 0.4, "grounding": 0.6, "rationale": 0.7}'::jsonb, '2026-11-27 23:40:23.294+00'::timestamptz),
('meta/muse-spark-1.1', 'E', 'A+', 'B', TRUE, 6.2, 21972, 0.05379075, '{"design": 1, "detail": 0.6, "contract": 1.2, "fidelity": 0.5, "grounding": 0.6, "rationale": 0.6}'::jsonb, '2026-11-27 23:40:23.298+00'::timestamptz),
('minimax/minimax-m3.1-flash', 'E', 'A+', 'A+', TRUE, 6.6, 16918, 0.003699225, '{"design": 0.7, "detail": 0.6, "contract": 1.2, "fidelity": 0.7, "grounding": 1, "rationale": 0.7}'::jsonb, '2026-11-27 23:40:23.296+00'::timestamptz),
('moonshotai/kimi-k2.7-code', 'F', 'C', 'A+', TRUE, 0, 233184, 0, NULL::jsonb, '2026-11-27 23:40:23.325+00'::timestamptz),
('moonshotai/kimi-k3', 'E', 'A+', 'B', TRUE, 7.9, 45075, 0.0758118246, '{"design": 1.2, "detail": 1.1, "contract": 1.3, "fidelity": 0.7, "grounding": 1, "rationale": 1}'::jsonb, '2026-11-27 23:40:53.533+00'::timestamptz),
('motif-technologies/motif-3', 'F', 'B', 'A+', TRUE, 0, 166051, 0.0085554, NULL::jsonb, '2026-11-27 23:40:23.307+00'::timestamptz),
('nex-agi/nex-n2.6', 'F', 'E', 'A+', TRUE, 0, 382035, 0, NULL::jsonb, '2026-11-27 23:40:23.323+00'::timestamptz),
('nvidia/switchyard', 'A', 'E', 'D', FALSE, 10.1, 399303, 0.2710339821, '{"design": 2.1, "detail": 1.2, "contract": 1.4, "fidelity": 1.8, "grounding": 1.5, "rationale": 1.6}'::jsonb, '2026-11-27 23:40:53.557+00'::timestamptz),
('openai/gpt-5.6-terra', 'E', 'A+', 'C', TRUE, 8.4, 48545, 0.1113645, '{"design": 1, "detail": 1.2, "contract": 1.3, "fidelity": 1.3, "grounding": 1.3, "rationale": 1.3}'::jsonb, '2026-11-27 23:40:53.54+00'::timestamptz),
('openai/gpt-6-sol', 'C', 'A+', 'C', TRUE, 9, 38046, 0.1123185, '{"design": 1.8, "detail": 0.9, "contract": 1.5, "fidelity": 1.2, "grounding": 1.3, "rationale": 1.2}'::jsonb, '2026-11-27 23:40:23.302+00'::timestamptz),
('openai/gpt-6.1-sol', 'A', 'A', 'C', FALSE, 10, 100631, 0.1089185, '{"design": 2.4, "detail": 1.4, "contract": 1.3, "fidelity": 1.3, "grounding": 1.4, "rationale": 1.6}'::jsonb, '2026-11-27 23:39:53.089+00'::timestamptz),
('openai/gpt-6.1-terra', 'E', 'A', 'B', TRUE, 8.4, 72402, 0.05365425, '{"design": 1, "detail": 1, "contract": 1.3, "fidelity": 1.5, "grounding": 1.2, "rationale": 1.4}'::jsonb, '2026-11-27 23:39:53.092+00'::timestamptz),
('openai/gpt-6.2-sol', 'D', 'A', 'C', TRUE, 8.6, 92106, 0.1067485, '{"design": 1, "detail": 1.2, "contract": 1.3, "fidelity": 1.4, "grounding": 1.3, "rationale": 1.5}'::jsonb, '2026-11-27 23:39:53.094+00'::timestamptz),
('openai/o3', 'F', 'A+', 'B', TRUE, 0, 15152, 0.050208, NULL::jsonb, '2026-11-27 23:40:53.543+00'::timestamptz),
('openrouter/auto-beta', 'C', 'B', 'D', TRUE, 9, 172684, 0.1593485, '{"design": 1.7, "detail": 0.9, "contract": 1, "fidelity": 1.5, "grounding": 1.5, "rationale": 1.1}'::jsonb, '2026-11-27 23:40:23.32+00'::timestamptz),
('particle-ai/particle-1:free', 'E', 'A', 'A+', TRUE, 5.8, 96232, 0, '{"design": 1, "detail": 0.5, "contract": 0.9, "fidelity": 0.6, "grounding": 0.6, "rationale": 0.5}'::jsonb, '2026-11-27 23:40:23.305+00'::timestamptz),
('radixark/daisyrose-27b', 'F', 'A', 'A+', TRUE, 0, 97251, 0.01280205, NULL::jsonb, '2026-11-27 23:40:23.309+00'::timestamptz),
('ricursiveai/ripple-65b-preview', 'E', 'B', 'A+', TRUE, 3.1, 121841, 0.0021761, '{"design": 0.4, "detail": 0.4, "contract": 0.8, "fidelity": 0.5, "grounding": 0.4, "rationale": 0.2}'::jsonb, '2026-11-27 23:40:23.315+00'::timestamptz),
('tencent/hy4', 'F', 'B', 'A', TRUE, 0, 159057, 0.027231139, NULL::jsonb, '2026-11-27 23:40:23.326+00'::timestamptz),
('thinkingmachines/inkling-2-small', 'E', 'A+', 'A+', TRUE, 5.4, 46891, 0.007828, '{"design": 0.7, "detail": 0.5, "contract": 1.1, "fidelity": 0.4, "grounding": 0.7, "rationale": 0.5}'::jsonb, '2026-11-27 23:40:23.31+00'::timestamptz),
('typesafe/jev-router', 'F', 'E', 'A+', TRUE, 0, 439259, 0, NULL::jsonb, '2026-11-27 23:40:53.565+00'::timestamptz),
('upstage/solar-mini-4-5', 'F', 'A+', 'A+', TRUE, 0, 8457, 0.00038676, NULL::jsonb, '2026-11-27 23:40:23.312+00'::timestamptz),
('upstage/solar-pro-4-contributor', 'F', 'A+', 'A+', TRUE, 0, 29397, 0.00405378, NULL::jsonb, '2026-11-27 23:40:23.314+00'::timestamptz),
('x-ai/grok-4.5', 'E', 'A+', 'B', TRUE, 5.9, 57648, 0.0734196, '{"design": 0.7, "detail": 0.6, "contract": 1.1, "fidelity": 0.7, "grounding": 0.9, "rationale": 0.7}'::jsonb, '2026-11-27 23:40:23.318+00'::timestamptz),
('x-ai/grok-4.6', 'D', 'A', 'B', TRUE, 8.7, 99810, 0.090336, '{"design": 1.5, "detail": 1.1, "contract": 1.3, "fidelity": 1.3, "grounding": 1.5, "rationale": 1.2}'::jsonb, '2026-11-27 23:40:53.561+00'::timestamptz),
('xiaomi/mimo-v2.6-flash-mopd', 'F', 'A+', 'A+', TRUE, 0, 25261, 0.0136415, NULL::jsonb, '2026-11-27 23:40:23.317+00'::timestamptz),
('xiaomi/mimo-v2.6-pro-ultraspeed', 'E', 'A', 'B', TRUE, 5.5, 68619, 0.07117167, '{"design": 0.6, "detail": 0.5, "contract": 1, "fidelity": 1, "grounding": 0.8, "rationale": 0.3}'::jsonb, '2026-11-27 23:40:53.563+00'::timestamptz),
('z-ai/glm-5.3-flashx-legal', 'E', 'A+', 'A', TRUE, 5.5, 48806, 0.01858724, '{"design": 0.9, "detail": 0.5, "contract": 0.8, "fidelity": 0.5, "grounding": 0.5, "rationale": 0.6}'::jsonb, '2026-11-27 23:40:23.321+00'::timestamptz)
) AS v("id", "ability", "speed", "cost", "discouraged", "score", "time_ms", "cost_usd", "categories", "benchmarked_at")
WHERE m."id" = v."id";

-- 2. Copy the newly graded targets onto their aliases.
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
    'moonshotai/kimi-k3',
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
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-sonnet-5.5',
  'baidu/ernie-5.5-flash-preview:free',
  'deepseek/deepseek-v4.1-flash',
  'fireworks/ember-1',
  'google/gemini-3.8-flash',
  'google/gemini-4-argon',
  'google/gemini-4-carbon',
  'google/gemini-4-hydrogen',
  'google/gemini-4-neon',
  'inclusionai/ling-3.0-tiny',
  'inclusionai/ling-3.2-flash',
  'inclusionai/lingsante-3.1-air-vl',
  'kt/midm-k-3.0-pro',
  'liquid/lfm-3-1.7b',
  'liquid/lfm-3-1.7b:free',
  'meta/muse-ember',
  'meta/muse-spark-1.1',
  'minimax/minimax-m3.1-flash',
  'moonshotai/kimi-k2.7-code',
  'moonshotai/kimi-k3',
  'motif-technologies/motif-3',
  'nex-agi/nex-n2.6',
  'nvidia/switchyard',
  'openai/gpt-5.6-terra',
  'openai/gpt-6-sol',
  'openai/gpt-6.1-sol',
  'openai/gpt-6.1-terra',
  'openai/gpt-6.2-sol',
  'openai/o3',
  'openrouter/auto-beta',
  'particle-ai/particle-1:free',
  'radixark/daisyrose-27b',
  'ricursiveai/ripple-65b-preview',
  'tencent/hy4',
  'thinkingmachines/inkling-2-small',
  'typesafe/jev-router',
  'upstage/solar-mini-4-5',
  'upstage/solar-pro-4-contributor',
  'x-ai/grok-4.5',
  'x-ai/grok-4.6',
  'xiaomi/mimo-v2.6-flash-mopd',
  'xiaomi/mimo-v2.6-pro-ultraspeed',
  'z-ai/glm-5.3-flashx-legal',
  '~anthropic/claude-opus-latest',
  '~anthropic/claude-sonnet-latest',
  '~google/gemini-pro-latest',
  '~google/gemini-flash-latest',
  '~moonshotai/kimi-latest',
  '~openai/gpt-terra-latest',
  '~openai/gpt-sol-latest'
)
  AND "discouraged" IS DISTINCT FROM (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  );
