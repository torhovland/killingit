import { eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { llmSettings } from "../db/schema.js";

export interface StoredLlmSettings {
  provider: string;
  apiKeyEncrypted: string;
  model: string;
}

/**
 * Persists the single LLM provider configuration (single-operator phase).
 * Upserts so saving again replaces the row rather than appending.
 */
export async function saveLlmSettings(
  settings: StoredLlmSettings,
): Promise<void> {
  // Explicit id 1 makes this a genuine single-row upsert. Inserting without an
  // id advances the sequence and appends a second row instead of conflicting.
  // Delete any legacy duplicates first so the fix is self-healing.
  await db.transaction(async (tx) => {
    await tx.delete(llmSettings).where(ne(llmSettings.id, 1));
    await tx
      .insert(llmSettings)
      .values({
        id: 1,
        provider: settings.provider,
        apiKeyEncrypted: settings.apiKeyEncrypted,
        model: settings.model,
      })
      .onConflictDoUpdate({
        target: llmSettings.id,
        set: {
          provider: settings.provider,
          apiKeyEncrypted: settings.apiKeyEncrypted,
          model: settings.model,
          updatedAt: new Date(),
        },
      });
  });
}

/**
 * Loads the stored (still encrypted) LLM configuration, or null when none is
 * configured. The API key is decrypted only by callers that need it.
 */
export async function loadLlmSettings(): Promise<StoredLlmSettings | null> {
  const rows = await db
    .select()
    .from(llmSettings)
    .where(eq(llmSettings.id, 1))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    provider: row.provider,
    apiKeyEncrypted: row.apiKeyEncrypted,
    model: row.model,
  };
}
