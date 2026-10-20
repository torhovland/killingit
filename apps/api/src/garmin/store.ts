import { db } from "../db/index.js";
import { garminConnections } from "../db/schema.js";

export interface EncryptedCredentials {
  usernameEncrypted: string;
  passwordEncrypted: string;
}

/**
 * Persists the single Garmin credential set (ADR 0003 amendment: one operator).
 * Upserts so re-entering credentials replaces the row rather than appending.
 */
export async function saveCredentials(
  credentials: EncryptedCredentials,
): Promise<void> {
  await db
    .insert(garminConnections)
    .values({
      usernameEncrypted: credentials.usernameEncrypted,
      passwordEncrypted: credentials.passwordEncrypted,
    })
    .onConflictDoUpdate({
      target: garminConnections.id,
      set: {
        usernameEncrypted: credentials.usernameEncrypted,
        passwordEncrypted: credentials.passwordEncrypted,
        updatedAt: new Date(),
      },
    });
}

/**
 * Loads the single stored (encrypted) credential set, or null when none is
 * configured. Ciphertext is never decrypted here — callers decrypt on demand
 * with the encryption key and never serialize it.
 */
export async function loadCredentials(): Promise<EncryptedCredentials | null> {
  const rows = await db.select().from(garminConnections).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    usernameEncrypted: row.usernameEncrypted,
    passwordEncrypted: row.passwordEncrypted,
  };
}
