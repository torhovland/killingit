import { decrypt } from "../crypto/credentials.js";
import { llmCredentialsKeyFromEnv } from "./credentials.js";
import { createOpenRouterProvider, type LlmProvider } from "./openrouter.js";
import { loadLlmSettings } from "./store.js";

export interface LlmClient {
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

/**
 * Loads the configured provider and decrypts its API key. Returns null when no
 * provider has been configured yet. Throws when the stored key cannot be
 * decrypted (a configuration problem the caller should surface).
 */
export async function loadLlmClient(): Promise<LlmClient | null> {
  const settings = await loadLlmSettings();
  if (!settings) {
    return null;
  }
  const key = await llmCredentialsKeyFromEnv();
  const apiKey = await decrypt(settings.apiKeyEncrypted, key);
  return {
    provider: createOpenRouterProvider(),
    apiKey,
    model: settings.model,
  };
}
