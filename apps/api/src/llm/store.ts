import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { llmSettings } from "../db/schema.js";

export interface StoredLlmSettings {
  provider: string;
  apiKeyEncrypted: string;
  /** Legacy single model, still returned for older callers. */
  model: string;
  seasonModel?: string;
  dailyModel?: string;
}

/**
 * Persists one account's LLM provider configuration. Upserts so saving again
 * replaces the row rather than appending.
 */
export async function saveLlmSettings(
  userId: number,
  settings: StoredLlmSettings,
): Promise<void> {
  await db
    .insert(llmSettings)
    .values({
      userId,
      provider: settings.provider,
      apiKeyEncrypted: settings.apiKeyEncrypted,
      model: settings.model,
      seasonModel: settings.seasonModel ?? settings.model,
      dailyModel: settings.dailyModel ?? settings.model,
    })
    .onConflictDoUpdate({
      target: llmSettings.userId,
      set: {
        provider: settings.provider,
        apiKeyEncrypted: settings.apiKeyEncrypted,
        model: settings.model,
        seasonModel: settings.seasonModel ?? settings.model,
        dailyModel: settings.dailyModel ?? settings.model,
        updatedAt: new Date(),
      },
    });
}

/**
 * Loads one account's stored (still encrypted) LLM configuration, or null when
 * none is configured. The API key is decrypted only by callers that need it.
 */
export async function loadLlmSettings(
  userId: number,
): Promise<StoredLlmSettings | null> {
  const rows = await db
    .select()
    .from(llmSettings)
    .where(eq(llmSettings.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    provider: row.provider,
    apiKeyEncrypted: row.apiKeyEncrypted,
    model: row.model,
    seasonModel: row.seasonModel ?? row.model,
    dailyModel: row.dailyModel ?? row.model,
  };
}
