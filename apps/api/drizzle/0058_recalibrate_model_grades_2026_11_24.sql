-- Recalibrate the model catalog after the 2026-11-24 benchmark runs.
--
-- This is a data migration. It:
--   1. inserts any benchmarked model the target database does not have yet,
--      including the models that currently exist only in the production catalog;
--   2. re-grades ability to the widened score bands (A+ >= 10.6, A >= 10.2,
--      B >= 9.8, C >= 9.4, D >= 9.0, E > 0), with a single weak rubric category
--      capping a model at C instead of forcing F;
--   3. re-grades speed to the new cuts (A+ < 60 s, A < 120 s, B < 180 s,
--      C < 240 s, D < 300 s, E < 600 s, F >= 600 s);
--   4. writes the measured grades from the three 2026-11-24 runs, using the
--      first successful result per model;
--   5. copies a graded target onto its aliases;
--   6. fills the estimated cost for any model whose measured cost is unknown,
--      and refreshes the estimate for the production-only models;
--   7. recomputes discouraged.
--
-- A row already graded F is left F when it has no fresh measurement: the stored
-- data cannot tell a hard gate failure from a category failure.

-- 1. Insert benchmarked models that are missing.
INSERT INTO "llm_models" ("id", "name", "retired", "discouraged", "ability", "speed", "cost", "benchmark_cost_usd", "needs_rescore", "prompt_price_per_million", "completion_price_per_million", "alias_target_slug", "first_seen_at", "last_seen_at", "updated_at")
VALUES
('amazon/nova-lite-v1', 'Amazon: Nova Lite 1.0', FALSE, FALSE, '?', '?', 'A+', 0.00408, FALSE, 0.06, 0.24, NULL, now(), now(), now()),
('amazon/nova-micro-v1', 'Amazon: Nova Micro 1.0', FALSE, FALSE, '?', '?', 'A+', 0.00252, FALSE, 0.04, 0.14, NULL, now(), now(), now()),
('amazon/nova-premier-v1', 'Amazon: Nova Premier 1.0', FALSE, FALSE, '?', '?', 'D', 0.195, FALSE, 2.5, 12.5, NULL, now(), now(), now()),
('anthropic/claude-haiku-5.5', 'Anthropic: Claude Haiku 5.5', FALSE, FALSE, '?', '?', 'A', 0.0078, FALSE, 0.1, 0.5, NULL, now(), now(), now()),
('baidu/ernie-5.5-flash-preview:free', 'Baidu: ERNIE-5.5-Flash-Preview (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('bytedance-seed/seed-2.0-mini', 'ByteDance Seed: Seed-2.0-Mini', FALSE, FALSE, '?', '?', 'A', 0.0068000000000000005, FALSE, 0.1, 0.4, NULL, now(), now(), now()),
('bytedance/ui-tars-1.5-7b', 'ByteDance: UI-TARS 7B ', FALSE, FALSE, '?', '?', 'A', 0.0048000000000000004, FALSE, 0.1, 0.2, NULL, now(), now(), now()),
('cohere/command-r-08-2024', 'Cohere: Command R (08-2024)', FALSE, FALSE, '?', '?', 'A', 0.0102, FALSE, 0.15, 0.6, NULL, now(), now(), now()),
('cohere/command-r7b-12-2024', 'Cohere: Command R7B (12-2024)', FALSE, FALSE, '?', '?', 'A+', 0.00262, FALSE, 0.04, 0.15, NULL, now(), now(), now()),
('deepseek/deepseek-chat-v3.1', 'DeepSeek: DeepSeek V3.1', FALSE, FALSE, '?', '?', 'A', 0.0165, FALSE, 0.25, 0.95, NULL, now(), now(), now()),
('deepseek/deepseek-v3.1-terminus', 'DeepSeek: DeepSeek V3.1 Terminus', FALSE, FALSE, '?', '?', 'A', 0.01756, FALSE, 0.27, 1, NULL, now(), now(), now()),
('deepseek/deepseek-v3.2', 'DeepSeek: DeepSeek V3.2', FALSE, FALSE, '?', '?', 'A', 0.01108, FALSE, 0.26, 0.38, NULL, now(), now(), now()),
('deepseek/deepseek-v3.2-exp', 'DeepSeek: DeepSeek V3.2 Exp', FALSE, FALSE, '?', '?', 'A', 0.01166, FALSE, 0.27, 0.41, NULL, now(), now(), now()),
('deepseek/deepseek-v4-flash', 'DeepSeek: DeepSeek V4 Flash 0423', FALSE, FALSE, '?', '?', 'A+', 0.00432, FALSE, 0.09, 0.18, NULL, now(), now(), now()),
('deepseek/deepseek-v4-flash-0731', 'DeepSeek: DeepSeek V4 Flash 0731', FALSE, FALSE, '?', '?', 'A+', 0.0044, FALSE, 0.05, 0.3, NULL, now(), now(), now()),
('deepseek/deepseek-v4.1-flash', 'DeepSeek: DeepSeek V4.1 Flash', FALSE, FALSE, '?', '?', 'A+', 0.0034000000000000002, FALSE, 0.05, 0.2, NULL, now(), now(), now()),
('deepseek/deepseek-v4.1-flash-1017', 'DeepSeek: DeepSeek V4.1 Flash 1017', FALSE, FALSE, '?', '?', 'A+', 0.00284, FALSE, 0.03, 0.2, NULL, now(), now(), now()),
('google/gemini-2.5-flash-lite', 'Google: Gemini 2.5 Flash Lite', FALSE, FALSE, '?', '?', 'A', 0.0068000000000000005, FALSE, 0.1, 0.4, NULL, now(), now(), now()),
('google/gemini-3.1-flash-lite', 'Google: Gemini 3.1 Flash Lite', FALSE, FALSE, '?', '?', 'A', 0.022, FALSE, 0.25, 1.5, NULL, now(), now(), now()),
('google/gemini-3.1-flash-lite-preview', 'Google: Gemini 3.1 Flash Lite Preview', FALSE, FALSE, '?', '?', 'A', 0.022, FALSE, 0.25, 1.5, NULL, now(), now(), now()),
('google/gemma-2-27b-it', 'Google: Gemma 2 27B', FALSE, FALSE, '?', '?', 'B', 0.0247, FALSE, 0.65, 0.65, NULL, now(), now(), now()),
('google/gemma-3-12b-it', 'Google: Gemma 3 12B', FALSE, FALSE, '?', '?', 'A+', 0.0029, FALSE, 0.05, 0.15, NULL, now(), now(), now()),
('google/gemma-3-27b-it', 'Google: Gemma 3 27B', FALSE, FALSE, '?', '?', 'A+', 0.0038399999999999997, FALSE, 0.08, 0.16, NULL, now(), now(), now()),
('google/gemma-3-4b-it', 'Google: Gemma 3 4B', FALSE, FALSE, '?', '?', 'A+', 0.00162, FALSE, 0.04, 0.05, NULL, now(), now(), now()),
('google/gemma-4-26b-a4b-it', 'Google: Gemma 4 26B A4B ', FALSE, FALSE, '?', '?', 'A+', 0.00484, FALSE, 0.08, 0.26, NULL, now(), now(), now()),
('google/gemma-4-26b-a4b-it:free', 'Google: Gemma 4 26B A4B  (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('google/gemma-4-31b-it', 'Google: Gemma 4 31B', FALSE, FALSE, '?', '?', 'A', 0.009600000000000001, FALSE, 0.2, 0.4, NULL, now(), now(), now()),
('google/gemma-4-31b-it:free', 'Google: Gemma 4 31B (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('ibm-granite/granite-4.2-8b', 'IBM: Granite 4.2 8B', FALSE, FALSE, '?', '?', 'A+', 0.00318, FALSE, 0.06, 0.15, NULL, now(), now(), now()),
('inclusionai/ling-3.0-flash', 'inclusionAI: Ling 3.0 Flash', FALSE, FALSE, '?', '?', 'A+', 0.00116, FALSE, 0.02, 0.06, NULL, now(), now(), now()),
('inclusionai/ling-3.0-flash-vl', 'inclusionAI: Ling 3.0 Flash VL', FALSE, FALSE, '?', '?', 'A+', 0.00348, FALSE, 0.06, 0.18, NULL, now(), now(), now()),
('inclusionai/ling-3.0-tiny', 'inclusionAI: Ling 3.0 Tiny', FALSE, FALSE, '?', '?', 'A+', 0.00106, FALSE, 0.02, 0.05, NULL, now(), now(), now()),
('inclusionai/ling-3.1-flash', 'inclusionAI: Ling 3.1 Flash', FALSE, FALSE, '?', '?', 'A+', 0.0044399999999999995, FALSE, 0.08, 0.22, NULL, now(), now(), now()),
('inclusionai/ling-3.2-flash:free', 'inclusionAI: Ling 3.2 Flash (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('inference-net/schematron-v2-small', 'Inference.net: Schematron V2 Small', FALSE, FALSE, '?', '?', 'A+', 0.0037, FALSE, 0.05, 0.23, NULL, now(), now(), now()),
('inference-net/schematron-v2-turbo', 'Inference.net: Schematron V2 Turbo', FALSE, FALSE, '?', '?', 'A+', 0.00234, FALSE, 0.03, 0.15, NULL, now(), now(), now()),
('liquid/lfm-3-1.7b', 'LiquidAI: LFM3-1.7B', FALSE, FALSE, '?', '?', 'A+', 0.00424, FALSE, 0.08, 0.2, NULL, now(), now(), now()),
('liquid/lfm-3-1.7b:free', 'LiquidAI: LFM3-1.7B (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('meta-llama/llama-3.1-8b-instruct', 'Meta: Llama 3.1 8B Instruct', FALSE, FALSE, '?', '?', 'A+', 0.0022, FALSE, 0.05, 0.08, NULL, now(), now(), now()),
('meta-llama/llama-3.2-3b-instruct', 'Meta: Llama 3.2 3B Instruct', FALSE, FALSE, '?', '?', 'A+', 0.0047, FALSE, 0.05, 0.33, NULL, now(), now(), now()),
('meta-llama/llama-4-scout', 'Meta: Llama 4 Scout', FALSE, FALSE, '?', '?', 'A', 0.0058, FALSE, 0.1, 0.3, NULL, now(), now(), now()),
('meta-llama/llama-guard-4-12b', 'Meta: Llama Guard 4 12B', FALSE, FALSE, '?', '?', 'A', 0.006840000000000001, FALSE, 0.18, 0.18, NULL, now(), now(), now()),
('meta/muse-spark-1.2-contributor', 'Meta: Muse Spark 1.2 Contributor', FALSE, FALSE, '?', '?', 'A', 0.0048000000000000004, FALSE, 0.1, 0.2, NULL, now(), now(), now()),
('meta/muse-spark-1.3-contributor', 'Meta: Muse Spark 1.3 Contributor', FALSE, FALSE, '?', '?', 'A', 0.0048000000000000004, FALSE, 0.1, 0.2, NULL, now(), now(), now()),
('microsoft/phi-4', 'Microsoft: Phi 4', FALSE, FALSE, '?', '?', 'A+', 0.0033600000000000006, FALSE, 0.07, 0.14, NULL, now(), now(), now()),
('mistralai/codestral-2508', 'Mistral: Codestral 2508', FALSE, FALSE, '?', '?', 'A', 0.0174, FALSE, 0.3, 0.9, NULL, now(), now(), now()),
('mistralai/ministral-14b-2512', 'Mistral: Ministral 3 14B 2512', FALSE, FALSE, '?', '?', 'A', 0.0076, FALSE, 0.2, 0.2, NULL, now(), now(), now()),
('mistralai/ministral-3b-2512', 'Mistral: Ministral 3 3B 2512', FALSE, FALSE, '?', '?', 'A', 0.0038, FALSE, 0.1, 0.1, NULL, now(), now(), now()),
('mistralai/ministral-8b-2512', 'Mistral: Ministral 3 8B 2512', FALSE, FALSE, '?', '?', 'A', 0.0057, FALSE, 0.15, 0.15, NULL, now(), now(), now()),
('mistralai/mistral-large-2512', 'Mistral: Mistral Large 3 2512', FALSE, FALSE, '?', '?', 'B', 0.028999999999999998, FALSE, 0.5, 1.5, NULL, now(), now(), now()),
('mistralai/mistral-nemo', 'Mistral: Mistral Nemo', FALSE, FALSE, '?', '?', 'A+', 0.00114, FALSE, 0.03, 0.03, NULL, now(), now(), now()),
('mistralai/mistral-saba', 'Mistral: Saba', FALSE, FALSE, '?', '?', 'A', 0.0116, FALSE, 0.2, 0.6, NULL, now(), now(), now()),
('mistralai/mistral-small-24b-instruct-2501', 'Mistral: Mistral Small 3', FALSE, FALSE, '?', '?', 'A+', 0.0022, FALSE, 0.05, 0.08, NULL, now(), now(), now()),
('mistralai/mistral-small-2603', 'Mistral: Mistral Small 4', FALSE, FALSE, '?', '?', 'A', 0.0102, FALSE, 0.15, 0.6, NULL, now(), now(), now()),
('mistralai/mistral-small-3.2-24b-instruct', 'Mistral: Mistral Small 3.2 24B', FALSE, FALSE, '?', '?', 'A+', 0.00424, FALSE, 0.08, 0.2, NULL, now(), now(), now()),
('mistralai/voxtral-small-24b-2507', 'Mistral: Voxtral Small 24B 2507', FALSE, FALSE, '?', '?', 'A', 0.0058, FALSE, 0.1, 0.3, NULL, now(), now(), now()),
('nex-agi/nex-n2.5-mini', 'Nex AGI: Nex-N2.5-Mini', FALSE, FALSE, '?', '?', 'A+', 0.00184, FALSE, 0.03, 0.1, NULL, now(), now(), now()),
('nex-agi/nex-n2.5-pro', 'Nex AGI: Nex-N2.5-Pro', FALSE, FALSE, '?', '?', 'A+', 0.004739999999999999, FALSE, 0.08, 0.25, NULL, now(), now(), now()),
('nvidia/nemotron-3-nano-30b-a3b', 'NVIDIA: Nemotron 3 Nano 30B A3B', FALSE, FALSE, '?', '?', 'A+', 0.00408, FALSE, 0.06, 0.24, NULL, now(), now(), now()),
('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'NVIDIA: Nemotron 3 Nano Omni (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('nvidia/nemotron-3-super-120b-a12b', 'NVIDIA: Nemotron 3 Super', FALSE, FALSE, '?', '?', 'A+', 0.00624, FALSE, 0.08, 0.4, NULL, now(), now(), now()),
('nvidia/nemotron-3-ultra-550b-a55b:free', 'NVIDIA: Nemotron 3 Ultra (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('nvidia/nemotron-3.5-content-safety', 'NVIDIA: Nemotron 3.5 Content Safety', FALSE, FALSE, '?', '?', 'A', 0.0076, FALSE, 0.2, 0.2, NULL, now(), now(), now()),
('nvidia/nemotron-3.5-lightning', 'NVIDIA: Nemotron 3.5 Lightning', FALSE, FALSE, '?', '?', 'A+', 0.0034000000000000002, FALSE, 0.05, 0.2, NULL, now(), now(), now()),
('nvidia/nemotron-3.5-lightning:free', 'NVIDIA: Nemotron 3.5 Lightning (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('nvidia/nemotron-3.5-super-vl:free', 'NVIDIA: Nemotron 3.5 Super VL (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('openai/gpt-3.5-turbo-0613', 'OpenAI: GPT-3.5 Turbo (older v0613)', FALSE, FALSE, '?', '?', 'C', 0.048, FALSE, 1, 2, NULL, now(), now(), now()),
('openai/gpt-3.5-turbo-16k', 'OpenAI: GPT-3.5 Turbo 16k', FALSE, FALSE, '?', '?', 'E', 0.124, FALSE, 3, 4, NULL, now(), now(), now()),
('openai/gpt-4.1-nano', 'OpenAI: GPT-4.1 Nano', FALSE, FALSE, '?', '?', 'A', 0.0068000000000000005, FALSE, 0.1, 0.4, NULL, now(), now(), now()),
('openai/gpt-4o-mini', 'OpenAI: GPT-4o-mini', FALSE, FALSE, '?', '?', 'A', 0.0102, FALSE, 0.15, 0.6, NULL, now(), now(), now()),
('openai/gpt-4o-mini-2024-07-18', 'OpenAI: GPT-4o-mini (2024-07-18)', FALSE, FALSE, '?', '?', 'A', 0.0102, FALSE, 0.15, 0.6, NULL, now(), now(), now()),
('openai/gpt-5-image', 'OpenAI: GPT-5 Image', FALSE, FALSE, '?', '?', 'E', 0.38, FALSE, 10, 10, NULL, now(), now(), now()),
('openai/gpt-5-image-mini', 'OpenAI: GPT-5 Image Mini', FALSE, FALSE, '?', '?', 'D', 0.09000000000000001, FALSE, 2.5, 2, NULL, now(), now(), now()),
('openai/gpt-5.2-chat', 'OpenAI: GPT-5.2 Chat', FALSE, FALSE, '?', '?', 'D', 0.189, FALSE, 1.75, 14, NULL, now(), now(), now()),
('openai/gpt-5.4-nano', 'OpenAI: GPT-5.4 Nano', FALSE, FALSE, '?', '?', 'A', 0.0181, FALSE, 0.2, 1.25, NULL, now(), now(), now()),
('openai/gpt-5.6-luna', 'OpenAI: GPT-5.6 Luna', FALSE, FALSE, '?', '?', 'A', 0.0176, FALSE, 0.2, 1.2, NULL, now(), now(), now()),
('openai/gpt-6-luna', 'OpenAI: GPT-6 Luna', FALSE, FALSE, '?', '?', 'A', 0.0078, FALSE, 0.1, 0.5, NULL, now(), now(), now()),
('openai/gpt-6-luna-pro', 'OpenAI: GPT-6 Luna Pro', FALSE, FALSE, '?', '?', 'A', 0.0078, FALSE, 0.1, 0.5, NULL, now(), now(), now()),
('openai/gpt-audio', 'OpenAI: GPT Audio', FALSE, FALSE, '?', '?', 'D', 0.17, FALSE, 2.5, 10, NULL, now(), now(), now()),
('openai/gpt-audio-mini', 'OpenAI: GPT Audio Mini', FALSE, FALSE, '?', '?', 'B', 0.0408, FALSE, 0.6, 2.4, NULL, now(), now(), now()),
('openai/gpt-oss-120b', 'OpenAI: gpt-oss-120b', FALSE, FALSE, '?', '?', 'A+', 0.0039, FALSE, 0.05, 0.25, NULL, now(), now(), now()),
('openai/gpt-oss-20b', 'OpenAI: gpt-oss-20b', FALSE, FALSE, '?', '?', 'A+', 0.00214, FALSE, 0.03, 0.13, NULL, now(), now(), now()),
('openai/gpt-oss-safeguard-20b', 'OpenAI: gpt-oss-safeguard-20b', FALSE, FALSE, '?', '?', 'A+', 0.00524, FALSE, 0.08, 0.3, NULL, now(), now(), now()),
('openrouter/bodybuilder', 'Body Builder (beta)', FALSE, FALSE, '?', '?', '?', NULL, FALSE, NULL, NULL, NULL, now(), now(), now()),
('openrouter/free', 'Free Models Router', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('particle-ai/particle-1:free', 'Particle AI: Particle-1 (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('perceptron/perceptron-mk1', 'Perceptron: Perceptron Mk1', FALSE, FALSE, '?', '?', 'A', 0.0192, FALSE, 0.15, 1.5, NULL, now(), now(), now()),
('perceptron/perceptron-mk1.5', 'Perceptron: Perceptron Mk1.5', FALSE, FALSE, '?', '?', 'A', 0.0192, FALSE, 0.15, 1.5, NULL, now(), now(), now()),
('prism-ml/ternary-bonsai-2-27b', 'PrismML: Ternary Bonsai 2 27B', FALSE, FALSE, '?', '?', 'A', 0.00724, FALSE, 0.08, 0.5, NULL, now(), now(), now()),
('prism-ml/ternary-bonsai-2-9b', 'PrismML: Ternary Bonsai 2 9B', FALSE, FALSE, '?', '?', 'A+', 0.0035399999999999997, FALSE, 0.08, 0.13, NULL, now(), now(), now()),
('qwen/qwen-2.5-72b-instruct', 'Qwen2.5 72B Instruct', FALSE, FALSE, '?', '?', 'B', 0.01408, FALSE, 0.36, 0.4, NULL, now(), now(), now()),
('qwen/qwen-plus', 'Qwen: Qwen-Plus', FALSE, FALSE, '?', '?', 'A', 0.01508, FALSE, 0.26, 0.78, NULL, now(), now(), now()),
('qwen/qwen3-30b-a3b', 'Qwen: Qwen3 30B A3B', FALSE, FALSE, '?', '?', 'A', 0.00836, FALSE, 0.12, 0.5, NULL, now(), now(), now()),
('qwen/qwen3-30b-a3b-instruct-2507', 'Qwen: Qwen3 30B A3B Instruct 2507', FALSE, FALSE, '?', '?', 'A', 0.0058, FALSE, 0.1, 0.3, NULL, now(), now(), now()),
('qwen/qwen3-32b', 'Qwen: Qwen3 32B', FALSE, FALSE, '?', '?', 'A+', 0.00504, FALSE, 0.08, 0.28, NULL, now(), now(), now()),
('qwen/qwen3-coder-30b-a3b-instruct', 'Qwen: Qwen3 Coder 30B A3B Instruct', FALSE, FALSE, '?', '?', 'A+', 0.00476, FALSE, 0.07, 0.28, NULL, now(), now(), now()),
('qwen/qwen3-coder-flash', 'Qwen: Qwen3 Coder Flash', FALSE, FALSE, '?', '?', 'A', 0.0154, FALSE, 0.2, 0.98, NULL, now(), now(), now()),
('qwen/qwen3-coder-next', 'Qwen: Qwen3 Coder Next', FALSE, FALSE, '?', '?', 'A', 0.01136, FALSE, 0.12, 0.8, NULL, now(), now(), now()),
('qwen/qwen3-vl-235b-a22b-instruct', 'Qwen: Qwen3 VL 235B A22B Instruct', FALSE, FALSE, '?', '?', 'B', 0.02488, FALSE, 0.21, 1.9, NULL, now(), now(), now()),
('qwen/qwen3-vl-30b-a3b-instruct', 'Qwen: Qwen3 VL 30B A3B Instruct', FALSE, FALSE, '?', '?', 'A', 0.0102, FALSE, 0.15, 0.6, NULL, now(), now(), now()),
('qwen/qwen3-vl-8b-instruct', 'Qwen: Qwen3 VL 8B Instruct', FALSE, FALSE, '?', '?', 'A', 0.014499999999999999, FALSE, 0.25, 0.75, NULL, now(), now(), now()),
('qwen/qwen3.5-flash-02-23', 'Qwen: Qwen3.5-Flash', FALSE, FALSE, '?', '?', 'A+', 0.00456, FALSE, 0.07, 0.26, NULL, now(), now(), now()),
('qwen/qwen3.7-flash', 'Qwen: Qwen3.7 Flash', FALSE, FALSE, '?', '?', 'A+', 0.00214, FALSE, 0.03, 0.13, NULL, now(), now(), now()),
('qwen/qwen3.8-flash', 'Qwen: Qwen3.8 Flash', FALSE, FALSE, '?', '?', 'A', 0.0089, FALSE, 0.15, 0.47, NULL, now(), now(), now()),
('qwen/qwen3.8-omni-flash', 'Qwen: Qwen3.8 Omni Flash', FALSE, FALSE, '?', '?', 'A', 0.0089, FALSE, 0.15, 0.47, NULL, now(), now(), now()),
('recursive/flint-v1.0:free', 'Recursive: Flint (free)', FALSE, FALSE, '?', '?', 'A+', 0, FALSE, 0, 0, NULL, now(), now(), now()),
('rekaai/reka-edge', 'Reka Edge', FALSE, FALSE, '?', '?', 'A', 0.0038, FALSE, 0.1, 0.1, NULL, now(), now(), now()),
('rekaai/reka-flash-3', 'Reka Flash 3', FALSE, FALSE, '?', '?', 'A', 0.0048000000000000004, FALSE, 0.1, 0.2, NULL, now(), now(), now()),
('relace/relace-apply-3', 'Relace: Relace Apply 3', FALSE, FALSE, '?', '?', 'C', 0.0363, FALSE, 0.85, 1.25, NULL, now(), now(), now()),
('sakana/fugu-max', 'Sakana: Fugu Max', FALSE, FALSE, '?', '?', 'D', 0.11599999999999999, FALSE, 2, 6, NULL, now(), now(), now()),
('sakana/fugu-ultra', 'Sakana: Fugu Ultra', FALSE, FALSE, '?', '?', 'E', 0.44, FALSE, 5, 30, NULL, now(), now(), now()),
('sakana/fugu-ultra-v2', 'Sakana: Fugu Ultra v2', FALSE, FALSE, '?', '?', 'E', 0.44, FALSE, 5, 30, NULL, now(), now(), now()),
('sakana/sakana-namazu', 'Sakana: Sakana Namazu', FALSE, FALSE, '?', '?', 'C', 0.06659999999999999, FALSE, 0.95, 4, NULL, now(), now(), now()),
('sao10k/l3-lunaris-8b', 'Sao10K: Llama 3 8B Lunaris', FALSE, FALSE, '?', '?', 'A+', 0.00162, FALSE, 0.04, 0.05, NULL, now(), now(), now()),
('scaledown/extract', 'ScaleDown: Extract', FALSE, FALSE, '?', '?', 'A+', 0.00112, FALSE, 0.04, 0, NULL, now(), now(), now()),
('scaledown/summarize', 'ScaleDown: Summarize', FALSE, FALSE, '?', '?', 'A+', 0.00112, FALSE, 0.04, 0, NULL, now(), now(), now()),
('tencent/hy-mt2-1.8b', 'Tencent: Hy-MT2-1.8B', FALSE, FALSE, '?', '?', 'A+', 0.00292, FALSE, 0.04, 0.18, NULL, now(), now(), now()),
('tencent/hy-mt2-30b-a3b', 'Tencent: Hy-MT2-30B-A3B', FALSE, FALSE, '?', '?', 'A+', 0.004960000000000001, FALSE, 0.07, 0.3, NULL, now(), now(), now()),
('tencent/hy-mt2-7b', 'Tencent: Hy-MT2-7B', FALSE, FALSE, '?', '?', 'A+', 0.004960000000000001, FALSE, 0.07, 0.3, NULL, now(), now(), now()),
('tencent/hy4-flash', 'Tencent: Hy4 flash', FALSE, FALSE, '?', '?', 'A+', 0.00252, FALSE, 0.04, 0.14, NULL, now(), now(), now()),
('thedrummer/cydonia-24b-v4.1', 'TheDrummer: Cydonia 24B V4.1', FALSE, FALSE, '?', '?', 'A', 0.013399999999999999, FALSE, 0.3, 0.5, NULL, now(), now(), now()),
('thinkingmachines/inkling-2-mini', 'Thinking Machines: Inkling 2 Mini', FALSE, FALSE, '?', '?', 'A+', 0.00524, FALSE, 0.08, 0.3, NULL, now(), now(), now()),
('upstage/solar-mini4', 'Upstage: Solar Mini 4', FALSE, FALSE, '?', '?', 'A+', 0.0034000000000000002, FALSE, 0.05, 0.2, NULL, now(), now(), now()),
('upstage/solar-pro4', 'Upstage: Solar Pro 4', FALSE, FALSE, '?', '?', 'A', 0.0102, FALSE, 0.15, 0.6, NULL, now(), now(), now()),
('xiaomi/mimo-v2.5', 'Xiaomi: MiMo-V2.5', FALSE, FALSE, '?', '?', 'B', 0.0312, FALSE, 0.4, 2, NULL, now(), now(), now()),
('xiaomi/mimo-v2.6-flash', 'Xiaomi: MiMo-V2.6-Flash', FALSE, FALSE, '?', '?', 'A', 0.006720000000000001, FALSE, 0.14, 0.28, NULL, now(), now(), now()),
('xiaomi/mimo-v2.6-pro', 'Xiaomi: MiMo-V2.6-Pro', FALSE, FALSE, '?', '?', 'B', 0.021019999999999997, FALSE, 0.44, 0.87, NULL, now(), now(), now()),
('z-ai/glm-4.5', 'Z.ai: GLM 4.5', FALSE, FALSE, '?', '?', 'B', 0.0388, FALSE, 0.6, 2.2, NULL, now(), now(), now()),
('z-ai/glm-4.6', 'Z.ai: GLM 4.6', FALSE, FALSE, '?', '?', 'B', 0.034, FALSE, 0.5, 2, NULL, now(), now(), now()),
('z-ai/glm-4.7-flash', 'Z.ai: GLM 4.7 Flash', FALSE, FALSE, '?', '?', 'A+', 0.00568, FALSE, 0.06, 0.4, NULL, now(), now(), now()),
('google/gemini-4-hydrogen', 'Google: Gemini 4 Hydrogen', FALSE, FALSE, '?', '?', 'C', 0.11699999999999999, FALSE, 1.5, 7.5, NULL, now(), now(), now()),
('unbiased/pareto-26.10-preview', 'Pareto 26.10 Preview', FALSE, FALSE, '?', '?', 'B', 0.054400000000000004, FALSE, 0.8, 3.2, NULL, now(), now(), now()),
('mistralai/pixtral-large-2502', 'Mistral: Pixtral Large 2502', FALSE, FALSE, '?', '?', 'C', 0.11599999999999999, FALSE, 2, 6, NULL, now(), now(), now()),
('openai/gpt-6.2-astra', 'OpenAI: GPT-6.2 Astra', FALSE, FALSE, '?', '?', 'E', 0.624, FALSE, 8, 40, NULL, now(), now(), now()),
('google/gemini-4-neon', 'Google: Gemini 4 Neon', FALSE, FALSE, '?', '?', 'D', 0.23399999999999999, FALSE, 3, 15, NULL, now(), now(), now()),
('openai/gpt-6.2-astra-pro', 'OpenAI: GPT-6.2 Astra Pro', FALSE, FALSE, '?', '?', 'E', 0.624, FALSE, 8, 40, NULL, now(), now(), now()),
('openai/gpt-6.2-sol-pro', 'OpenAI: GPT-6.2 Sol Pro', FALSE, FALSE, '?', '?', 'D', 0.156, FALSE, 2, 10, NULL, now(), now(), now()),
('anthropic/claude-fable-5.2', 'Anthropic: Claude Fable 5.2', FALSE, FALSE, '?', '?', 'E', 0.624, FALSE, 8, 40, NULL, now(), now(), now()),
('qwen/qwen4-max', 'Qwen: Qwen4 Max', FALSE, FALSE, '?', '?', 'B', 0.08245999999999999, FALSE, 1.42, 4.27, NULL, now(), now(), now()),
('radixark/daisyrose-27b', 'RadixArk: DaisyRose 27B', FALSE, FALSE, '?', '?', 'A', 0.023, FALSE, 0.15, 1.88, NULL, now(), now(), now()),
('openai/gpt-6.2-sol', 'OpenAI: GPT-6.2 Sol', FALSE, FALSE, '?', '?', 'D', 0.156, FALSE, 2, 10, NULL, now(), now(), now()),
('motif-technologies/motif-3', 'Motif Technologies: Motif 3', FALSE, FALSE, '?', '?', 'A', 0.0204, FALSE, 0.3, 1.2, NULL, now(), now(), now()),
('nex-agi/nex-n2.6', 'Nex AGI: Nex-N2.6', FALSE, FALSE, '?', '?', 'A+', 0.00736, FALSE, 0.12, 0.4, NULL, now(), now(), now()),
('thinkingmachines/inkling-2-small', 'Thinking Machines: Inkling 2 Small', FALSE, FALSE, '?', '?', 'A', 0.0184, FALSE, 0.3, 1, NULL, now(), now(), now()),
('baidu/ernie-light-dt-1.0-intl', 'Baidu: ERNIE-Light-DT-1.0', FALSE, FALSE, '?', '?', 'B', 0.07103999999999999, FALSE, 1.13, 3.94, NULL, now(), now(), now()),
('meta/muse-ember', 'Meta: Muse Ember', FALSE, FALSE, '?', '?', 'A+', 0.0078, FALSE, 0.1, 0.5, NULL, now(), now(), now()),
('google/gemini-4-carbon', 'Google: Gemini 4 Carbon', FALSE, FALSE, '?', '?', 'D', 0.156, FALSE, 2, 10, NULL, now(), now(), now()),
('kt/midm-k-3.0-pro', 'KT: Mi:dm K 3.0 Pro', FALSE, FALSE, '?', '?', 'A+', 0.013600000000000001, FALSE, 0.2, 0.8, NULL, now(), now(), now())
ON CONFLICT ("id") DO NOTHING;

-- 2. Re-grade existing ability bands under the widened cuts.
WITH bands AS (
  SELECT
    "id",
    "speed",
    "cost",
    CASE
      WHEN "benchmark_score" >= 10.6 THEN 'A+'
      WHEN "benchmark_score" >= 10.2 THEN 'A'
      WHEN "benchmark_score" >= 9.8 THEN 'B'
      WHEN "benchmark_score" >= 9.4 THEN 'C'
      WHEN "benchmark_score" >= 9.0 THEN 'D'
      ELSE 'E'
    END AS band,
    (("benchmark_categories" ->> 'contract')::numeric) < 0.75
      OR (("benchmark_categories" ->> 'fidelity')::numeric) < 1
      OR (("benchmark_categories" ->> 'design')::numeric) < 1.5
      OR (("benchmark_categories" ->> 'rationale')::numeric) < 1
      OR (("benchmark_categories" ->> 'grounding')::numeric) < 1
      OR (("benchmark_categories" ->> 'detail')::numeric) < 1 AS weak
  FROM "llm_models"
  WHERE "ability" IN ('A+', 'A', 'B', 'C', 'D', 'E')
    AND "benchmark_score" > 0
    AND "benchmark_categories" IS NOT NULL
), regraded AS (
  SELECT
    "id",
    CASE WHEN weak AND band IN ('A+', 'A', 'B') THEN 'C' ELSE band END AS new_ability
  FROM bands
)
UPDATE "llm_models" AS m
SET "ability" = r.new_ability, "updated_at" = now()
FROM regraded AS r
WHERE m."id" = r."id"
  AND m."ability" IS DISTINCT FROM r.new_ability;

-- 3. Re-grade speed under the new cuts.
UPDATE "llm_models" AS m
SET
  "speed" = CASE
    WHEN "benchmark_time_ms" < 60000 THEN 'A+'
    WHEN "benchmark_time_ms" < 120000 THEN 'A'
    WHEN "benchmark_time_ms" < 180000 THEN 'B'
    WHEN "benchmark_time_ms" < 240000 THEN 'C'
    WHEN "benchmark_time_ms" < 300000 THEN 'D'
    WHEN "benchmark_time_ms" < 600000 THEN 'E'
    ELSE 'F'
  END,
  "updated_at" = now()
WHERE "benchmark_time_ms" IS NOT NULL
  AND "speed" IS DISTINCT FROM CASE
    WHEN "benchmark_time_ms" < 60000 THEN 'A+'
    WHEN "benchmark_time_ms" < 120000 THEN 'A'
    WHEN "benchmark_time_ms" < 180000 THEN 'B'
    WHEN "benchmark_time_ms" < 240000 THEN 'C'
    WHEN "benchmark_time_ms" < 300000 THEN 'D'
    WHEN "benchmark_time_ms" < 600000 THEN 'E'
    ELSE 'F'
  END;

-- 4. Write the measured grades from the 2026-11-24 runs.
UPDATE "llm_models" AS m
SET
  "ability" = v."ability",
  "speed" = v."speed",
  "cost" = v."cost",
  "benchmark_score" = v."score",
  "benchmark_time_ms" = v."time_ms",
  "benchmark_cost_usd" = v."cost_usd",
  "benchmark_categories" = v."categories",
  "benchmarked_at" = v."benchmarked_at",
  "needs_rescore" = FALSE,
  "updated_at" = now()
FROM (VALUES
('amazon/nova-lite-v1', 'E', 'A', 'A+', 4.7, 95890, 0.0034392, '{"contract":0.6,"fidelity":0.6,"design":1.2,"rationale":0.5,"grounding":0.6,"detail":0.6}'::jsonb, '2026-11-24T11:50:53.670Z'::timestamptz),
('amazon/nova-micro-v1', 'E', 'A+', 'A+', 5, 45455, 0.00304101, '{"contract":0.6,"fidelity":0.5,"design":1,"rationale":0.8,"grounding":0.6,"detail":0.6}'::jsonb, '2026-11-24T09:39:18.844Z'::timestamptz),
('anthropic/claude-haiku-5.5', 'E', 'E', 'A', 7.9, 372230, 0.0295516, '{"contract":1,"fidelity":0.6,"design":1.6,"rationale":1.2,"grounding":0.8,"detail":1.1}'::jsonb, '2026-11-24T15:40:18.423Z'::timestamptz),
('bytedance-seed/seed-2.0-mini', 'E', 'A', 'A+', 8.7, 77727, 0.008187199999999999, '{"contract":1.2,"fidelity":1.4,"design":1.7,"rationale":1.2,"grounding":1.3,"detail":1.4}'::jsonb, '2026-11-24T09:39:18.845Z'::timestamptz),
('deepseek/deepseek-chat-v3.1', 'E', 'A', 'A', 7.9, 96044, 0.0168362, '{"contract":1.3,"fidelity":1.1,"design":1.8,"rationale":1.2,"grounding":1.2,"detail":1}'::jsonb, '2026-11-24T09:39:18.845Z'::timestamptz),
('deepseek/deepseek-v3.1-terminus', 'E', 'C', 'A+', 6.7, 228370, 0.01318022, '{"contract":1.3,"fidelity":0.5,"design":1.6,"rationale":0.9,"grounding":0.9,"detail":0.9}'::jsonb, '2026-11-24T09:39:20.515Z'::timestamptz),
('deepseek/deepseek-v3.2', 'E', 'D', 'A+', 8.6, 281621, 0.00928174, '{"contract":1.2,"fidelity":1.4,"design":1.7,"rationale":1.1,"grounding":1.3,"detail":1.1}'::jsonb, '2026-11-24T09:39:58.730Z'::timestamptz),
('deepseek/deepseek-v3.2-exp', 'E', 'D', 'A+', 6.9, 276881, 0.00978772, '{"contract":1,"fidelity":0.4,"design":1.9,"rationale":1.2,"grounding":0.6,"detail":1}'::jsonb, '2026-11-24T09:40:04.306Z'::timestamptz),
('deepseek/deepseek-v4-flash', 'E', 'B', 'A+', 7.8, 177495, 0.00979454, '{"contract":1.2,"fidelity":1,"design":1.8,"rationale":1.2,"grounding":1.1,"detail":1.1}'::jsonb, '2026-11-24T09:40:29.432Z'::timestamptz),
('deepseek/deepseek-v4-flash-0731', 'E', 'D', 'A+', 8.7, 261114, 0.00767438, '{"contract":1,"fidelity":1.2,"design":1.9,"rationale":1.4,"grounding":1.2,"detail":1.3}'::jsonb, '2026-11-24T17:47:14.306Z'::timestamptz),
('deepseek/deepseek-v4.1-flash', 'B', 'C', 'A', 9.9, 214065, 0.015074103, '{"contract":1.3,"fidelity":1.5,"design":2,"rationale":1.6,"grounding":1.4,"detail":1.4}'::jsonb, '2026-11-24T17:47:14.306Z'::timestamptz),
('deepseek/deepseek-v4.1-flash-1017', 'D', 'B', 'A+', 9.3, 152633, 0.00865662, '{"contract":1.3,"fidelity":1.1,"design":2.2,"rationale":1.6,"grounding":1.2,"detail":1.4}'::jsonb, '2026-11-24T17:50:30.230Z'::timestamptz),
('google/gemini-2.5-flash-lite', 'E', 'A+', 'A+', 7.4, 24824, 0.0073972000000000005, '{"contract":1,"fidelity":0.6,"design":1.8,"rationale":1.1,"grounding":1.1,"detail":1.1}'::jsonb, '2026-11-24T09:43:08.888Z'::timestamptz),
('google/gemini-3.1-flash-lite', 'E', 'A+', 'A', 6.6, 33963, 0.016666, '{"contract":1.2,"fidelity":0.8,"design":1.2,"rationale":0.9,"grounding":0.8,"detail":0.8}'::jsonb, '2026-11-24T09:43:26.931Z'::timestamptz),
('google/gemini-3.1-flash-lite-preview', 'E', 'A+', 'A', 7, 16269, 0.016214, '{"contract":1,"fidelity":0.8,"design":1.7,"rationale":1,"grounding":1,"detail":0.9}'::jsonb, '2026-11-24T09:43:33.729Z'::timestamptz),
('google/gemma-3-27b-it', 'E', 'D', 'A+', 5.8, 255029, 0.00582508, '{"contract":1,"fidelity":0.4,"design":1,"rationale":0.9,"grounding":0.4,"detail":0.9}'::jsonb, '2026-11-24T09:44:20.721Z'::timestamptz),
('google/gemma-4-31b-it', 'E', 'A+', 'A+', 6.6, 46354, 0.005611485, '{"contract":1,"fidelity":0.9,"design":1.2,"rationale":0.9,"grounding":1.1,"detail":0.7}'::jsonb, '2026-11-24T09:44:52.691Z'::timestamptz),
('inclusionai/ling-3.0-flash-vl', 'E', 'D', 'A+', 6.3, 248012, 0.0037443479999999998, '{"contract":1,"fidelity":0.4,"design":1,"rationale":1.2,"grounding":0.3,"detail":1}'::jsonb, '2026-11-24T17:53:02.866Z'::timestamptz),
('mistralai/codestral-2508', 'F', 'A+', 'A+', 4.6, 36226, 0.014792099999999999, '{"contract":0.9,"fidelity":0.4,"design":0.5,"rationale":0.8,"grounding":0.4,"detail":0.6}'::jsonb, '2026-11-24T09:50:19.475Z'::timestamptz),
('mistralai/mistral-large-2512', 'E', 'A', 'A', 8, 82830, 0.027266949999999998, '{"contract":1.1,"fidelity":0.5,"design":2,"rationale":1.5,"grounding":0.6,"detail":1.4}'::jsonb, '2026-11-24T09:51:15.053Z'::timestamptz),
('mistralai/mistral-saba', 'E', 'A', 'A', 4.7, 100682, 0.01997812, '{"contract":0.6,"fidelity":0.4,"design":1.2,"rationale":0.7,"grounding":0.5,"detail":0.8}'::jsonb, '2026-11-24T12:19:17.819Z'::timestamptz),
('mistralai/mistral-small-2603', 'E', 'A', 'A+', 4.8, 66042, 0.008975034, '{"contract":0.6,"fidelity":0.5,"design":1,"rationale":0.8,"grounding":0.5,"detail":0.9}'::jsonb, '2026-11-24T09:52:39.570Z'::timestamptz),
('mistralai/voxtral-small-24b-2507', 'F', 'A+', 'A+', 4.8, 45737, 0.005162806000000001, '{"contract":1.2,"fidelity":0.4,"design":0.3,"rationale":0.8,"grounding":0.4,"detail":1}'::jsonb, '2026-11-24T09:53:10.564Z'::timestamptz),
('nvidia/nemotron-3-super-120b-a12b', 'E', 'E', 'A', 6.8, 503468, 0.03060645, '{"contract":0.9,"fidelity":0.6,"design":1.9,"rationale":1,"grounding":0.7,"detail":0.8}'::jsonb, '2026-11-24T12:18:51.788Z'::timestamptz),
('nvidia/nemotron-3-ultra-550b-a55b:free', 'F', 'F', 'A+', 7.3, 627438, 0, '{"contract":1.2,"fidelity":0.6,"design":1,"rationale":1.1,"grounding":1.1,"detail":1.1}'::jsonb, '2026-11-24T09:54:04.679Z'::timestamptz),
('nvidia/nemotron-3.5-super-vl:free', 'F', 'F', 'A+', 8.4, 747957, 0, '{"contract":1,"fidelity":0.8,"design":1.9,"rationale":1.2,"grounding":0.9,"detail":1.1}'::jsonb, '2026-11-24T16:33:57.061Z'::timestamptz),
('openai/gpt-4.1-nano', 'F', 'A+', 'A+', 5, 21812, 0.00448924, '{"contract":0.7,"fidelity":0.5,"design":0.9,"rationale":0.8,"grounding":0.5,"detail":0.7}'::jsonb, '2026-11-24T10:00:32.818Z'::timestamptz),
('openai/gpt-4o-mini', 'F', 'B', 'A+', 5.3, 169031, 0.0100374, '{"contract":0.9,"fidelity":0.6,"design":0.5,"rationale":0.6,"grounding":0.5,"detail":0.9}'::jsonb, '2026-11-24T10:00:41.777Z'::timestamptz),
('openai/gpt-4o-mini-2024-07-18', 'F', 'B', 'A+', 4.7, 167915, 0.008572199999999999, '{"contract":0.8,"fidelity":0.3,"design":0.3,"rationale":0.6,"grounding":0.5,"detail":0.6}'::jsonb, '2026-11-24T10:00:53.557Z'::timestamptz),
('openai/gpt-5-image', 'D', 'B', 'E', 9.3, 170109, 0.50169, '{"contract":1.3,"fidelity":1.2,"design":2,"rationale":1.5,"grounding":1.4,"detail":1.3}'::jsonb, '2026-11-24T16:40:27.363Z'::timestamptz),
('openai/gpt-5-image-mini', 'E', 'B', 'B', 7, 166064, 0.09539, '{"contract":1,"fidelity":0.8,"design":1.2,"rationale":1,"grounding":0.9,"detail":1.1}'::jsonb, '2026-11-24T10:00:59.975Z'::timestamptz),
('openai/gpt-5.4-nano', 'E', 'A+', 'A', 6.5, 59220, 0.01645925, '{"contract":0.6,"fidelity":0.4,"design":0.9,"rationale":0.9,"grounding":0.7,"detail":0.7}'::jsonb, '2026-11-24T10:02:49.695Z'::timestamptz),
('openai/gpt-5.6-luna', 'C', 'A', 'A', 9.6, 81874, 0.015850299999999998, '{"contract":1.4,"fidelity":1.4,"design":2,"rationale":1.5,"grounding":1.5,"detail":1.4}'::jsonb, '2026-11-24T10:03:08.843Z'::timestamptz),
('openai/gpt-6-luna', 'E', 'E', 'A+', 8.3, 337176, 0.01133932, '{"contract":0.9,"fidelity":0.8,"design":1.9,"rationale":1.2,"grounding":0.9,"detail":1.2}'::jsonb, '2026-11-24T12:10:57.471Z'::timestamptz),
('openai/gpt-6-luna-pro', 'E', 'D', 'A', 7.1, 288744, 0.029755160000000003, '{"contract":1,"fidelity":0.8,"design":1.8,"rationale":1.3,"grounding":0.8,"detail":1.1}'::jsonb, '2026-11-24T10:03:41.501Z'::timestamptz),
('openai/gpt-oss-120b', 'E', 'A+', 'A+', 6.3, 50790, 0.00602525, '{"contract":0.9,"fidelity":0.6,"design":1.2,"rationale":0.8,"grounding":0.5,"detail":0.9}'::jsonb, '2026-11-24T10:03:48.946Z'::timestamptz),
('openai/gpt-oss-20b', 'F', 'E', 'A+', 5.4, 362958, 0.0064071221999999995, '{"contract":1.2,"fidelity":0.5,"design":0.4,"rationale":0.6,"grounding":0.3,"detail":1}'::jsonb, '2026-11-24T10:03:49.094Z'::timestamptz),
('openai/gpt-oss-safeguard-20b', 'F', 'A', 'A+', 5.4, 76287, 0.00485934, '{"contract":0.6,"fidelity":0.5,"design":0.9,"rationale":0.7,"grounding":0.9,"detail":0.6}'::jsonb, '2026-11-24T10:04:30.747Z'::timestamptz),
('openrouter/free', 'E', 'F', 'A+', 8.1, 990876, 0, '{"contract":0.9,"fidelity":0.7,"design":1.9,"rationale":1.2,"grounding":1,"detail":1.1}'::jsonb, '2026-11-24T11:06:15.784Z'::timestamptz),
('particle-ai/particle-1:free', 'B', 'B', 'A+', 9.8, 123163, 0, '{"contract":1.4,"fidelity":1.3,"design":2.2,"rationale":1.6,"grounding":1.3,"detail":1.4}'::jsonb, '2026-11-24T11:09:32.584Z'::timestamptz),
('perceptron/perceptron-mk1', 'E', 'B', 'A', 7, 134778, 0.016240499999999998, '{"contract":1.3,"fidelity":0.6,"design":1,"rationale":1,"grounding":0.9,"detail":1.1}'::jsonb, '2026-11-24T10:04:44.897Z'::timestamptz),
('perceptron/perceptron-mk1.5', 'E', 'A+', 'A', 6.7, 23176, 0.016569, '{"contract":1,"fidelity":0.6,"design":0.7,"rationale":0.6,"grounding":1,"detail":0.9}'::jsonb, '2026-11-24T10:04:52.823Z'::timestamptz),
('qwen/qwen-2.5-72b-instruct', 'E', 'C', 'A+', 5.6, 180142, 0.01285792, '{"contract":1,"fidelity":0.6,"design":1.2,"rationale":0.9,"grounding":0.6,"detail":0.5}'::jsonb, '2026-11-24T10:06:03.131Z'::timestamptz),
('qwen/qwen-plus', 'E', 'B', 'A+', 6.8, 143379, 0.013210860000000001, '{"contract":1,"fidelity":0.3,"design":1.9,"rationale":1.2,"grounding":0.4,"detail":1.2}'::jsonb, '2026-11-24T10:06:05.138Z'::timestamptz),
('qwen/qwen3-30b-a3b', 'E', 'B', 'A+', 5.8, 139357, 0.0096832, '{"contract":1,"fidelity":0.5,"design":1,"rationale":0.8,"grounding":0.9,"detail":0.9}'::jsonb, '2026-11-24T10:06:37.392Z'::timestamptz),
('qwen/qwen3-30b-a3b-instruct-2507', 'E', 'E', 'A+', 6.1, 562040, 0.0109303, '{"contract":1,"fidelity":0.4,"design":1.2,"rationale":0.9,"grounding":0.3,"detail":1.1}'::jsonb, '2026-11-24T12:11:57.024Z'::timestamptz),
('qwen/qwen3-coder-flash', 'E', 'D', 'A', 6.8, 288078, 0.037654929, '{"contract":1,"fidelity":0.6,"design":1.2,"rationale":0.8,"grounding":1,"detail":1}'::jsonb, '2026-11-24T12:24:29.147Z'::timestamptz),
('qwen/qwen3-vl-235b-a22b-instruct', 'E', 'D', 'A', 7.3, 245373, 0.01514459, '{"contract":1.3,"fidelity":0.8,"design":1,"rationale":0.6,"grounding":1.2,"detail":1}'::jsonb, '2026-11-24T10:09:03.306Z'::timestamptz),
('qwen/qwen3-vl-30b-a3b-instruct', 'E', 'E', 'A+', 5.3, 485974, 0.01042815, '{"contract":0.9,"fidelity":0.6,"design":1.2,"rationale":0.8,"grounding":0.5,"detail":0.8}'::jsonb, '2026-11-24T10:09:52.107Z'::timestamptz),
('qwen/qwen3-vl-8b-instruct', 'E', 'A', 'A', 6.3, 87993, 0.0160335, '{"contract":1,"fidelity":0.6,"design":1.2,"rationale":1.1,"grounding":0.9,"detail":1}'::jsonb, '2026-11-24T10:10:27.338Z'::timestamptz),
('qwen/qwen3.5-flash-02-23', 'E', 'B', 'A+', 7.7, 167988, 0.010313290000000001, '{"contract":1.2,"fidelity":0.7,"design":1.3,"rationale":0.9,"grounding":1.2,"detail":1.1}'::jsonb, '2026-11-24T16:46:25.025Z'::timestamptz),
('qwen/qwen3.7-flash', 'E', 'B', 'A+', 7.8, 160982, 0.00357239, '{"contract":1.2,"fidelity":0.7,"design":1.8,"rationale":1.1,"grounding":1.1,"detail":1.1}'::jsonb, '2026-11-24T10:12:46.992Z'::timestamptz),
('qwen/qwen3.8-omni-flash', 'C', 'D', 'A+', 9.5, 257446, 0.0144438, '{"contract":1.3,"fidelity":1.5,"design":2.2,"rationale":1.5,"grounding":1.2,"detail":1.4}'::jsonb, '2026-11-24T10:13:27.041Z'::timestamptz),
('tencent/hy4-flash', 'E', 'C', 'A+', 7.6, 215694, 0.0020514915, '{"contract":1,"fidelity":0.9,"design":2,"rationale":1.3,"grounding":0.9,"detail":1.1}'::jsonb, '2026-11-24T18:22:47.344Z'::timestamptz),
('thedrummer/cydonia-24b-v4.1', 'E', 'B', 'A+', 7.2, 120124, 0.0115174, '{"contract":1.2,"fidelity":0.4,"design":1.5,"rationale":1,"grounding":0.4,"detail":1.1}'::jsonb, '2026-11-24T10:15:32.206Z'::timestamptz),
('thinkingmachines/inkling-2-mini', 'F', 'A+', 'A+', 7.1, 24119, 0.00474255, '{"contract":1.1,"fidelity":0.7,"design":0.9,"rationale":0.9,"grounding":0.9,"detail":0.7}'::jsonb, '2026-11-24T18:26:23.052Z'::timestamptz),
('upstage/solar-mini4', 'E', 'D', 'A+', 6.7, 251465, 0.00532325, '{"contract":1,"fidelity":0.5,"design":1.4,"rationale":1.2,"grounding":0.6,"detail":1.1}'::jsonb, '2026-11-24T11:57:18.846Z'::timestamptz),
('upstage/solar-pro4', 'E', 'A', 'A+', 8.8, 96773, 0.01283805, '{"contract":1.3,"fidelity":1.1,"design":1.9,"rationale":1.3,"grounding":1.3,"detail":1.5}'::jsonb, '2026-11-24T10:17:32.374Z'::timestamptz),
('xiaomi/mimo-v2.6-flash', 'E', 'A', 'A+', 8.6, 114227, 0.005488664, '{"contract":1,"fidelity":1.2,"design":1.8,"rationale":1.3,"grounding":1.4,"detail":1.1}'::jsonb, '2026-11-24T18:27:39.523Z'::timestamptz),
('z-ai/glm-4.6', 'E', 'E', 'A', 8.8, 355277, 0.0307416, '{"contract":1.1,"fidelity":1.1,"design":2,"rationale":1.4,"grounding":0.9,"detail":1.2}'::jsonb, '2026-11-24T17:23:46.128Z'::timestamptz),
('z-ai/glm-4.7-flash', 'E', 'F', 'A+', 6.6, 897127, 0.006418489, '{"contract":0.9,"fidelity":0.9,"design":1.2,"rationale":0.9,"grounding":0.9,"detail":1}'::jsonb, '2026-11-24T11:56:27.482Z'::timestamptz)
) AS v("id", "ability", "speed", "cost", "score", "time_ms", "cost_usd", "categories", "benchmarked_at")
WHERE m."id" = v."id";

-- 5. Copy the target's grades onto its aliases.
UPDATE "llm_models" AS a
SET
  "ability" = t."ability",
  "speed" = t."speed",
  "cost" = t."cost",
  "benchmark_score" = t."benchmark_score",
  "benchmark_time_ms" = t."benchmark_time_ms",
  "benchmark_cost_usd" = t."benchmark_cost_usd",
  "benchmark_categories" = t."benchmark_categories",
  "benchmarked_at" = t."benchmarked_at",
  "needs_rescore" = FALSE,
  "updated_at" = now()
FROM "llm_models" AS t
WHERE a."alias_target_slug" = t."id"
  AND t."benchmark_score" IS NOT NULL
  AND (
    a."ability" IS DISTINCT FROM t."ability"
    OR a."speed" IS DISTINCT FROM t."speed"
    OR a."cost" IS DISTINCT FROM t."cost"
    OR a."benchmark_score" IS DISTINCT FROM t."benchmark_score"
  );

-- 6. Estimate the cost of a model whose measured cost is still unknown. The
--    estimate assumes both benchmark prompts: 28,000 prompt tokens and 10,000
--    completion tokens including reasoning.
UPDATE "llm_models"
SET
  "benchmark_cost_usd" = (
    COALESCE("prompt_price_per_million", 0) * 28000
    + COALESCE("completion_price_per_million", 0) * 10000
  ) / 1000000,
  "cost" = CASE
    WHEN (
      COALESCE("prompt_price_per_million", 0) * 28000
      + COALESCE("completion_price_per_million", 0) * 10000
    ) / 1000000 < 0.015 THEN 'A+'
    WHEN (
      COALESCE("prompt_price_per_million", 0) * 28000
      + COALESCE("completion_price_per_million", 0) * 10000
    ) / 1000000 < 0.04 THEN 'A'
    WHEN (
      COALESCE("prompt_price_per_million", 0) * 28000
      + COALESCE("completion_price_per_million", 0) * 10000
    ) / 1000000 < 0.1 THEN 'B'
    WHEN (
      COALESCE("prompt_price_per_million", 0) * 28000
      + COALESCE("completion_price_per_million", 0) * 10000
    ) / 1000000 < 0.15 THEN 'C'
    WHEN (
      COALESCE("prompt_price_per_million", 0) * 28000
      + COALESCE("completion_price_per_million", 0) * 10000
    ) / 1000000 < 0.35 THEN 'D'
    WHEN (
      COALESCE("prompt_price_per_million", 0) * 28000
      + COALESCE("completion_price_per_million", 0) * 10000
    ) / 1000000 < 2.5 THEN 'E'
    ELSE 'F'
  END,
  "updated_at" = now()
WHERE (
    "benchmark_cost_usd" IS NULL
    AND ("prompt_price_per_million" IS NOT NULL OR "completion_price_per_million" IS NOT NULL)
  )
  OR (
    "benchmark_score" IS NULL
    AND "id" IN (
      'google/gemini-4-hydrogen',
      'unbiased/pareto-26.10-preview',
      'mistralai/pixtral-large-2502',
      'openai/gpt-6.2-astra',
      'google/gemini-4-neon',
      'openai/gpt-6.2-astra-pro',
      'openai/gpt-6.2-sol-pro',
      'anthropic/claude-fable-5.2',
      'qwen/qwen4-max',
      'radixark/daisyrose-27b',
      'openai/gpt-6.2-sol',
      'motif-technologies/motif-3',
      'nex-agi/nex-n2.6',
      'thinkingmachines/inkling-2-small',
      'baidu/ernie-light-dt-1.0-intl',
      'meta/muse-ember',
      'google/gemini-4-carbon',
      'kt/midm-k-3.0-pro'
    )
  );

-- 7. Recompute discouraged under the same rule the application uses.
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
