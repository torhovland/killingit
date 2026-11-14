import {
  CREDENTIAL_FAILURE_STATUS,
  UpstreamError,
} from "../http/upstreamError.js";
import type { GarminCredentials } from "./client.js";
import { decrypt, garminCredentialsKeyFromEnv } from "./crypto.js";
import { loadCredentials } from "./store.js";

/**
 * The account has no stored Garmin connection. It answers like a rejected
 * credential, because the athlete fixes both in Settings; it must never be a
 * 401, which the web client would retry as an expired session.
 */
export class GarminNotConnectedError extends UpstreamError {
  constructor() {
    super("Not connected to Garmin", CREDENTIAL_FAILURE_STATUS, {
      code: "garmin_auth_failed",
    });
    this.name = "GarminNotConnectedError";
  }
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
  const key = await garminCredentialsKeyFromEnv();
  return {
    username: await decrypt(stored.usernameEncrypted, key),
    password: await decrypt(stored.passwordEncrypted, key),
  };
}
