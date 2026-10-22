import type { GarminCredentials } from "./client.js";
import { decrypt, garminCredentialsKeyFromEnv } from "./crypto.js";
import { loadCredentials } from "./store.js";

/**
 * Loads and decrypts one user's stored Garmin credential set. Returns null when
 * none is configured; ciphertext never leaves this module.
 */
export async function loadDecryptedGarminCredentials(
  userId: number,
): Promise<GarminCredentials | null> {
  const stored = await loadCredentials(userId);
  if (!stored) {
    return null;
  }
  const key = await garminCredentialsKeyFromEnv();
  return {
    username: await decrypt(stored.usernameEncrypted, key),
    password: await decrypt(stored.passwordEncrypted, key),
  };
}
