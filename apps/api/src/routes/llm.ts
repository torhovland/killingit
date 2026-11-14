import {
  llmCatalogResponseSchema,
  llmCostsResponseSchema,
  llmModelsResponseSchema,
  llmSettingsSchema,
  llmSettingsUpdateSchema,
  type LlmSettings,
} from "@killingit/shared";
import { zValidator } from "../http/validation.js";
import { Hono } from "hono";
import { getUser } from "../auth/middleware.js";
import {
  badRequest,
  respondUpstreamError,
  serviceUnavailable,
} from "../http/errors.js";
import { encrypt } from "../crypto/credentials.js";
import type { ResolvedAppDependencies } from "../dependencies.js";
import { loadLlmCosts } from "../llm/costStore.js";
import { llmCredentialsKeyFromEnv } from "../llm/credentials.js";
import { createOpenRouterProvider } from "../llm/openrouter.js";
import {
  ensureModelCatalogFresh,
  loadModelCatalog,
} from "../llm/modelCatalog.js";
import { loadLlmSettings, saveLlmSettings } from "../llm/store.js";

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

/**
 * LLM provider configuration and model discovery (ADR 0004). Each account
 * configures its own provider key and model. The API key is validated against
 * OpenRouter before being stored encrypted, and is never serialized back to the
 * client.
 */
export function createLlmRoute(deps: ResolvedAppDependencies): Hono {
  const loadSettings = deps.loadLlmSettings ?? loadLlmSettings;
  const saveSettings = deps.saveLlmSettings ?? saveLlmSettings;
  const loadCosts = deps.loadLlmCosts ?? loadLlmCosts;
  const loadCatalog = deps.loadModelCatalog ?? loadModelCatalog;
  const refreshCatalog = deps.refreshModelCatalog ?? ensureModelCatalogFresh;
  const provider = deps.llmProvider ?? createOpenRouterProvider();
  const credentialsKey = deps.llmCredentialsKey ?? llmCredentialsKeyFromEnv;

  return new Hono()
    .get("/settings", async (c) => {
      const user = getUser(c);
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
        const user = getUser(c);
        const existing = await loadSettings(user.id);
        // A key-only update keeps the stored models, so rotating a key never
        // races a model change made in the table below the key form.
        const nextSeasonModel =
          seasonModel ?? model ?? existing?.seasonModel ?? existing?.model;
        const nextDailyModel =
          dailyModel ?? model ?? existing?.dailyModel ?? existing?.model;
        if (!nextSeasonModel || !nextDailyModel) {
          return badRequest(
            c,
            "Choose both a season planning model and a day-to-day model",
          );
        }

        let key: CryptoKey;
        try {
          key = await credentialsKey();
        } catch (err) {
          return serviceUnavailable(c, (err as Error).message);
        }

        let apiKeyEncrypted = existing?.apiKeyEncrypted;

        if (apiKey !== undefined) {
          try {
            await provider.validateKey(apiKey);
          } catch (err) {
            return respondUpstreamError(c, err, "[llm] provider failure");
          }
          apiKeyEncrypted = await encrypt(apiKey, key);
        }
        if (apiKeyEncrypted === undefined) {
          return badRequest(c, "An OpenRouter API key is required");
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
              return badRequest(c, `Unknown OpenRouter model: ${chosen}`);
            }
          }
        } catch (err) {
          return respondUpstreamError(c, err, "[llm] provider failure");
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
    .get("/costs", async (c) => {
      const user = getUser(c);
      try {
        const costs = await loadCosts(user.id);
        return c.json(llmCostsResponseSchema.parse(costs));
      } catch (err) {
        console.error("[llm] could not load the cost history:", err);
        return serviceUnavailable(c);
      }
    })
    .get("/models", async (c) => {
      try {
        const models = await provider.listModels();
        return c.json(llmModelsResponseSchema.parse({ models }));
      } catch (err) {
        return respondUpstreamError(c, err, "[llm] provider failure");
      }
    })
    .get("/catalog", async (c) => {
      try {
        const models = await loadCatalog();
        return c.json(llmCatalogResponseSchema.parse({ models }));
      } catch (err) {
        console.error("[llm] could not load the model catalog:", err);
        return serviceUnavailable(c);
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
