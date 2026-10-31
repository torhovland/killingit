import { decrypt } from "../crypto/credentials.js";
import { withPromptLogging } from "./callLog.js";
import { llmCredentialsKeyFromEnv } from "./credentials.js";
import { modelIsUsable } from "./modelCatalog.js";
import { createOpenRouterProvider, type LlmProvider } from "./openrouter.js";
import { loadLlmSettings } from "./store.js";

export type LlmModelRole = "season" | "daily" | "all";

/** Raised when a stored model is retired or discouraged in the catalog. */
export class LlmModelChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmModelChoiceError";
  }
}

export interface LlmClient {
  provider: LlmProvider;
  apiKey: string;
  /** Daily model, retained as the default for existing call sites. */
  model: string;
  seasonModel?: string;
  dailyModel?: string;
}

export async function assertModelUsable(
  model: string,
  role: "season" | "daily",
) {
  const state = await modelIsUsable(model);
  if (state === null || state.usable) return;
  const problem = state.retired ? "retired" : "discouraged";
  throw new LlmModelChoiceError(
    `Your ${role === "season" ? "season planning" : "day-to-day"} model ${model} is ${problem}. Open Settings and choose another model.`,
  );
}

/**
 * Loads the account's configured provider and decrypts its API key. Returns
 * null when the account has not configured a provider yet. Throws when the
 * stored key cannot be decrypted (a configuration problem the caller should
 * surface).
 */
export async function loadLlmClient(
  userId: number,
  role: LlmModelRole = "daily",
): Promise<LlmClient | null> {
  const settings = await loadLlmSettings(userId);
  if (!settings) {
    return null;
  }
  const seasonModel = settings.seasonModel ?? settings.model;
  const dailyModel = settings.dailyModel ?? settings.model;
  if (role === "season" || role === "all") {
    await assertModelUsable(seasonModel, "season");
  }
  if (role === "daily" || role === "all") {
    await assertModelUsable(dailyModel, "daily");
  }
  const key = await llmCredentialsKeyFromEnv();
  const apiKey = await decrypt(settings.apiKeyEncrypted, key);
  return {
    provider: withPromptLogging(createOpenRouterProvider(), { userId }),
    apiKey,
    model: dailyModel,
    seasonModel,
    dailyModel,
  };
}
