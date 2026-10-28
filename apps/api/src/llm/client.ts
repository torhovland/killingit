import { decrypt } from "../crypto/credentials.js";
import { withPromptLogging } from "./callLog.js";
import { llmCredentialsKeyFromEnv } from "./credentials.js";
import { createOpenRouterProvider, type LlmProvider } from "./openrouter.js";
import { loadLlmSettings } from "./store.js";

export interface LlmClient {
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

/**
 * Loads the account's configured provider and decrypts its API key. Returns
 * null when the account has not configured a provider yet. Throws when the
 * stored key cannot be decrypted (a configuration problem the caller should
 * surface).
 */
export async function loadLlmClient(userId: number): Promise<LlmClient | null> {
  const settings = await loadLlmSettings(userId);
  if (!settings) {
    return null;
  }
  const key = await llmCredentialsKeyFromEnv();
  const apiKey = await decrypt(settings.apiKeyEncrypted, key);
  return {
    provider: withPromptLogging(createOpenRouterProvider(), { userId }),
    apiKey,
    model: settings.model,
  };
}
