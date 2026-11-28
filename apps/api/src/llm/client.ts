import { decrypt } from "../crypto/credentials.js";
import { AthleteFacingError } from "../http/errors.js";
import { withPromptLogging } from "./callLog.js";
import { llmCredentialsKeyFromEnv } from "./credentials.js";
import { modelAvailability } from "./modelCatalog.js";
import { modelChoiceMessage } from "./modelChoice.js";
import { createOpenRouterProvider, type LlmProvider } from "./openrouter.js";
import { loadLlmSettings } from "./store.js";

export type LlmModelRole = "season" | "daily" | "all";

/**
 * Raised when a stored model is retired in the catalog. The message tells the
 * athlete which Settings change fixes it, so it stays visible; see ADR 0038.
 */
export class LlmModelChoiceError extends AthleteFacingError {
  constructor(message: string) {
    super(message);
    this.name = "LlmModelChoiceError";
  }
}

export interface LlmClient {
  provider: LlmProvider;
  apiKey: string;
  seasonModel: string;
  dailyModel: string;
}

async function assertModelUsable(model: string, role: "season" | "daily") {
  const availability = await modelAvailability(model);
  if (availability === "available") return;
  throw new LlmModelChoiceError(modelChoiceMessage(model, role, availability));
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
  const seasonModel = settings.seasonModel;
  const dailyModel = settings.dailyModel;
  if (role === "season" || role === "all") {
    await assertModelUsable(seasonModel, "season");
  }
  if (role === "daily" || role === "all") {
    await assertModelUsable(dailyModel, "daily");
  }
  const keys = await llmCredentialsKeyFromEnv();
  const apiKey = await decrypt(settings.apiKeyEncrypted, keys, userId);
  return {
    provider: withPromptLogging(createOpenRouterProvider(), { userId }),
    apiKey,
    seasonModel,
    dailyModel,
  };
}
