import { credentialsKeyFromEnv } from "../crypto/credentials.js";

/**
 * Garmin credentials use the shared AES-256-GCM helper with a Garmin-specific
 * environment secret. Re-exported here so the Garmin integration keeps its
 * existing module boundary and tests.
 */
export {
  CredentialCryptoError,
  decrypt,
  encrypt,
  keyFromRaw,
} from "../crypto/credentials.js";

/** Reads `GARMIN_CREDENTIALS_KEY` and derives the Garmin encryption key. */
export function garminCredentialsKeyFromEnv(): Promise<CryptoKey> {
  return credentialsKeyFromEnv("GARMIN_CREDENTIALS_KEY");
}
