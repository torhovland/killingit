import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { llmSettings } from "../db/schema.js";

export interface StoredLlmSettings {
  provider: string;
  apiKeyEncrypted: string;
  seasonModel: string;
  dailyModel: string;
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
      model: settings.dailyModel,
      seasonModel: settings.seasonModel,
      dailyModel: settings.dailyModel,
    })
    .onConflictDoUpdate({
      target: llmSettings.userId,
      set: {
        provider: settings.provider,
        apiKeyEncrypted: settings.apiKeyEncrypted,
        model: settings.dailyModel,
        seasonModel: settings.seasonModel,
        dailyModel: settings.dailyModel,
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
    // Rows written before the split stored only the legacy model.
    seasonModel: row.seasonModel ?? row.model,
    dailyModel: row.dailyModel ?? row.model,
  };
}
