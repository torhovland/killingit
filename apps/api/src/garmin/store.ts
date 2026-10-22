import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { garminConnections } from "../db/schema.js";

export interface EncryptedCredentials {
  usernameEncrypted: string;
  passwordEncrypted: string;
}

/**
 * Persists a user's Garmin credential set. Upserts on `user_id` so re-entering
 * credentials replaces that user's row rather than appending.
 */
export async function saveCredentials(
  userId: number,
  credentials: EncryptedCredentials,
): Promise<void> {
  await db
    .insert(garminConnections)
    .values({
      userId,
      usernameEncrypted: credentials.usernameEncrypted,
      passwordEncrypted: credentials.passwordEncrypted,
    })
    .onConflictDoUpdate({
      target: garminConnections.userId,
      set: {
        usernameEncrypted: credentials.usernameEncrypted,
        passwordEncrypted: credentials.passwordEncrypted,
        updatedAt: new Date(),
      },
    });
}

/**
 * Loads one user's stored (encrypted) credential set, or null when none is
 * configured. Ciphertext is never decrypted here — callers decrypt on demand
 * with the encryption key and never serialize it.
 */
export async function loadCredentials(
  userId: number,
): Promise<EncryptedCredentials | null> {
  const rows = await db
    .select()
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    usernameEncrypted: row.usernameEncrypted,
    passwordEncrypted: row.passwordEncrypted,
  };
}
