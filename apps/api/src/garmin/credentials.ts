import {
  credentialsKeyFromEnv,
  decrypt,
  type CredentialKeys,
} from "../crypto/credentials.js";
import type { GarminCredentials } from "./client.js";
import { loadCredentials } from "./store.js";

/**
 * Reads `GARMIN_CREDENTIALS_KEY` and derives the Garmin encryption keys. Kept
 * apart from the LLM key so either secret can be rotated independently.
 */
export function garminCredentialsKeyFromEnv(): Promise<CredentialKeys> {
  return credentialsKeyFromEnv("GARMIN_CREDENTIALS_KEY");
}

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
  const keys = await garminCredentialsKeyFromEnv();
  return {
    username: await decrypt(stored.usernameEncrypted, keys, userId),
    password: await decrypt(stored.passwordEncrypted, keys, userId),
  };
}
