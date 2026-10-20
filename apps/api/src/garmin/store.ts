import { eq, ne } from "drizzle-orm";
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
  // Fixed id 1 is required for a real single-row upsert; an insert without an
  // id would advance the sequence and append a second row. Delete any legacy
  // duplicates first so the fix is self-healing.
  await db.transaction(async (tx) => {
    await tx.delete(garminConnections).where(ne(garminConnections.id, 1));
    await tx
      .insert(garminConnections)
      .values({
        id: 1,
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
  });
}

/**
 * Loads the single stored (encrypted) credential set, or null when none is
 * configured. Ciphertext is never decrypted here — callers decrypt on demand
 * with the encryption key and never serialize it.
 */
export async function loadCredentials(): Promise<EncryptedCredentials | null> {
  const rows = await db
    .select()
    .from(garminConnections)
    .where(eq(garminConnections.id, 1))
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
