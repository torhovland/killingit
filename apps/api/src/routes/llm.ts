import {
  llmModelsResponseSchema,
  llmSettingsSchema,
  llmSettingsUpdateSchema,
  type LlmSettings,
} from "@killingit/shared";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import { encrypt } from "../crypto/credentials.js";
import { llmCredentialsKeyFromEnv } from "../llm/credentials.js";
import {
  createOpenRouterProvider,
  LlmAuthError,
  LlmProviderError,
} from "../llm/openrouter.js";
import { loadLlmSettings, saveLlmSettings } from "../llm/store.js";
import type { UserStore } from "../users/store.js";

export interface LlmRouteDependencies {
  users: UserStore;
  /** Injectable for route tests; defaults to the database-backed store. */
  loadSettings?: typeof loadLlmSettings;
  saveSettings?: typeof saveLlmSettings;
}

/** Reads the stored configuration without ever exposing the encrypted key. */
function settingsFromStored(stored: {
  provider: string;
  model: string;
}): LlmSettings {
  return {
    configured: true,
    provider: stored.provider,
    model: stored.model,
  };
}

/** Maps provider failures to useful HTTP responses. */
function respondProviderError(c: Context, err: unknown): Response {
  if (err instanceof LlmAuthError) {
    return c.text(err.message, 401);
  }
  if (err instanceof LlmProviderError && err.status !== undefined) {
    c.status(err.status as 400 | 401 | 402 | 429 | 502 | 503);
    return c.text(err.message);
  }
  console.error("[llm] provider failure:", err);
  return c.text("Service Unavailable", 503);
}

/**
 * LLM provider configuration and model discovery (ADR 0004). Each account
 * configures its own provider key and model. The API key is validated against
 * OpenRouter before being stored encrypted, and is never serialized back to the
 * client.
 */
export function createLlmRoute(deps: LlmRouteDependencies): Hono {
  const loadSettings = deps.loadSettings ?? loadLlmSettings;
  const saveSettings = deps.saveSettings ?? saveLlmSettings;

  return new Hono()
    .get("/settings", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const stored = await loadSettings(user.id);
      return c.json(
        llmSettingsSchema.parse(
          stored
            ? settingsFromStored(stored)
            : { configured: false, provider: "openrouter", model: null },
        ),
      );
    })
    .put(
      "/settings",
      zValidator("json", llmSettingsUpdateSchema),
      async (c) => {
        const { apiKey, model } = c.req.valid("json");
        const user = await deps.users.ensureUser(getAthlete(c).sub);

        let key: CryptoKey;
        try {
          key = await llmCredentialsKeyFromEnv();
        } catch (err) {
          return c.text((err as Error).message, 503);
        }

        const existing = await loadSettings(user.id);
        const provider = createOpenRouterProvider();
        let apiKeyEncrypted = existing?.apiKeyEncrypted;

        if (apiKey !== undefined) {
          try {
            await provider.validateKey(apiKey);
          } catch (err) {
            return respondProviderError(c, err);
          }
          apiKeyEncrypted = await encrypt(apiKey, key);
        }
        if (apiKeyEncrypted === undefined) {
          return c.text("An OpenRouter API key is required", 400);
        }

        // Reject typos before they become silent per-activity failures later.
        try {
          const models = await provider.listModels();
          if (!models.some((candidate) => candidate.id === model)) {
            return c.text(`Unknown OpenRouter model: ${model}`, 400);
          }
        } catch (err) {
          return respondProviderError(c, err);
        }

        await saveSettings(user.id, {
          provider: provider.id,
          apiKeyEncrypted,
          model,
        });
        return c.json(settingsFromStored({ provider: provider.id, model }));
      },
    )
    .get("/models", async (c) => {
      const provider = createOpenRouterProvider();
      try {
        const models = await provider.listModels();
        return c.json(llmModelsResponseSchema.parse({ models }));
      } catch (err) {
        return respondProviderError(c, err);
      }
    });
}
