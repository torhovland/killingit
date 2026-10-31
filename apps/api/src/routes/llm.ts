import {
  llmCatalogResponseSchema,
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
import {
  ensureModelCatalogFresh,
  loadModelCatalog,
} from "../llm/modelCatalog.js";
import { loadLlmSettings, saveLlmSettings } from "../llm/store.js";
import type { UserStore } from "../users/store.js";

export interface LlmRouteDependencies {
  users: UserStore;
  /** Injectable for route tests; defaults to the database-backed store. */
  loadSettings?: typeof loadLlmSettings;
  saveSettings?: typeof saveLlmSettings;
  /** Injectable for route tests; defaults to the graded catalog. */
  loadCatalog?: typeof loadModelCatalog;
  /** Injectable for route tests; defaults to the 24-hour refresh job. */
  refreshCatalog?: typeof ensureModelCatalogFresh;
}

/** Reads the stored configuration without ever exposing the encrypted key. */
function settingsFromStored(stored: {
  provider: string;
  model: string;
  seasonModel?: string;
  dailyModel?: string;
}): LlmSettings {
  return {
    configured: true,
    provider: stored.provider,
    model: stored.model,
    seasonModel: stored.seasonModel ?? stored.model,
    dailyModel: stored.dailyModel ?? stored.model,
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
  const loadCatalog = deps.loadCatalog ?? loadModelCatalog;
  const refreshCatalog = deps.refreshCatalog ?? ensureModelCatalogFresh;

  return new Hono()
    .get("/settings", async (c) => {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const stored = await loadSettings(user.id);
      return c.json(
        llmSettingsSchema.parse(
          stored
            ? settingsFromStored(stored)
            : {
                configured: false,
                provider: "openrouter",
                model: null,
                seasonModel: null,
                dailyModel: null,
              },
        ),
      );
    })
    .put(
      "/settings",
      zValidator("json", llmSettingsUpdateSchema),
      async (c) => {
        const { apiKey, model, seasonModel, dailyModel } = c.req.valid("json");
        const user = await deps.users.ensureUser(getAthlete(c).sub);
        const nextSeasonModel = seasonModel ?? model;
        const nextDailyModel = dailyModel ?? model;
        if (!nextSeasonModel || !nextDailyModel) {
          return c.text(
            "Choose both a season planning model and a day-to-day model",
            400,
          );
        }

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
          const catalog = await loadCatalog();
          const known =
            catalog.length > 0
              ? new Set(catalog.map((candidate) => candidate.id))
              : new Set(
                  (await provider.listModels()).map(
                    (candidate) => candidate.id,
                  ),
                );
          for (const chosen of [nextSeasonModel, nextDailyModel]) {
            if (!known.has(chosen)) {
              return c.text(`Unknown OpenRouter model: ${chosen}`, 400);
            }
          }
        } catch (err) {
          return respondProviderError(c, err);
        }

        await saveSettings(user.id, {
          provider: provider.id,
          apiKeyEncrypted,
          model: nextDailyModel,
          seasonModel: nextSeasonModel,
          dailyModel: nextDailyModel,
        });
        return c.json(
          settingsFromStored({
            provider: provider.id,
            model: nextDailyModel,
            seasonModel: nextSeasonModel,
            dailyModel: nextDailyModel,
          }),
        );
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
    })
    .get("/catalog", async (c) => {
      try {
        const models = await loadCatalog();
        return c.json(llmCatalogResponseSchema.parse({ models }));
      } catch (err) {
        console.error("[llm] could not load the model catalog:", err);
        return c.text("Service Unavailable", 503);
      }
    })
    .post("/models/refresh", (c) => {
      // Page visits fire this without waiting; the job itself is rate-limited
      // to one OpenRouter catalog check every 24 hours.
      void refreshCatalog().catch((err: unknown) => {
        console.error("[llm] model catalog refresh failed:", err);
      });
      return c.json({ started: true }, 202);
    });
}
