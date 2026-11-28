-- Ungrade the models last scored before 23 November with cost D or worse.
--
-- These rows were graded on the old three-prompt suite and are outside the
-- two-prompt regrade in 0060. Setting ability to ? puts them back in the
-- pending benchmark queue; speed, cost and the historical score stay as they
-- were so the catalog still shows what was measured.
UPDATE "llm_models"
SET
  "ability" = '?',
  "needs_rescore" = TRUE,
  "updated_at" = now()
WHERE "id" IN (
'aion-labs/aion-3.0',
'aion-labs/aion-3.5',
'anthropic/claude-fable-5',
'anthropic/claude-fable-5.1',
'anthropic/claude-opus-4.1',
'anthropic/claude-opus-4.5',
'anthropic/claude-opus-4.6',
'anthropic/claude-opus-4.7',
'anthropic/claude-opus-4.8',
'anthropic/claude-opus-5',
'anthropic/claude-sonnet-4.5',
'anthropic/claude-sonnet-5',
'google/gemini-2.5-pro-preview',
'google/gemini-3.1-pro-preview',
'google/gemini-3.1-pro-preview-customtools',
'google/gemini-3.5-flash',
'google/gemini-nano-banana-2.1',
'google/lyria-3-clip-preview',
'google/lyria-3-pro-preview',
'meta/muse-wonder',
'moonshotai/kimi-k2.6',
'openai/gpt-5',
'openai/gpt-5-pro',
'openai/gpt-5.2-pro',
'openai/gpt-5.4-image-2',
'openai/gpt-5.4-pro',
'openai/gpt-5.5',
'openai/gpt-5.5-pro',
'openai/gpt-5.6-sol',
'openai/gpt-5.6-sol-pro',
'openai/gpt-5.6-terra-pro',
'openai/gpt-6-astra',
'openai/gpt-6-astra-pro',
'openai/gpt-6-sol-pro',
'openai/gpt-6.1-sol-pro',
'openai/gpt-chat-latest',
'openai/o3-pro',
'openrouter/fusion',
'openrouter/pareto-code',
'perplexity/sonar-deep-research',
'perplexity/sonar-pro-search',
'qwen/qwen3.8-2.4t-a95b',
'qwen/qwen3.8-max-prime',
'x-ai/grok-4.20-multi-agent',
'x-ai/grok-4.7',
'z-ai/glm-5.1',
'~x-ai/grok-latest'
);

-- Recompute discouraged after clearing ability on these rows.
UPDATE "llm_models"
SET
  "discouraged" = (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  ),
  "updated_at" = now()
WHERE "id" IN (
'aion-labs/aion-3.0',
'aion-labs/aion-3.5',
'anthropic/claude-fable-5',
'anthropic/claude-fable-5.1',
'anthropic/claude-opus-4.1',
'anthropic/claude-opus-4.5',
'anthropic/claude-opus-4.6',
'anthropic/claude-opus-4.7',
'anthropic/claude-opus-4.8',
'anthropic/claude-opus-5',
'anthropic/claude-sonnet-4.5',
'anthropic/claude-sonnet-5',
'google/gemini-2.5-pro-preview',
'google/gemini-3.1-pro-preview',
'google/gemini-3.1-pro-preview-customtools',
'google/gemini-3.5-flash',
'google/gemini-nano-banana-2.1',
'google/lyria-3-clip-preview',
'google/lyria-3-pro-preview',
'meta/muse-wonder',
'moonshotai/kimi-k2.6',
'openai/gpt-5',
'openai/gpt-5-pro',
'openai/gpt-5.2-pro',
'openai/gpt-5.4-image-2',
'openai/gpt-5.4-pro',
'openai/gpt-5.5',
'openai/gpt-5.5-pro',
'openai/gpt-5.6-sol',
'openai/gpt-5.6-sol-pro',
'openai/gpt-5.6-terra-pro',
'openai/gpt-6-astra',
'openai/gpt-6-astra-pro',
'openai/gpt-6-sol-pro',
'openai/gpt-6.1-sol-pro',
'openai/gpt-chat-latest',
'openai/o3-pro',
'openrouter/fusion',
'openrouter/pareto-code',
'perplexity/sonar-deep-research',
'perplexity/sonar-pro-search',
'qwen/qwen3.8-2.4t-a95b',
'qwen/qwen3.8-max-prime',
'x-ai/grok-4.20-multi-agent',
'x-ai/grok-4.7',
'z-ai/glm-5.1',
'~x-ai/grok-latest'
)
  AND "discouraged" IS DISTINCT FROM (
    "ability" IN ('C', 'D', 'E', 'F')
    OR "speed" = 'F'
    OR "cost" = 'F'
  );
