import {
  credentialsKeyFromEnv,
  type CredentialKeys,
} from "../crypto/credentials.js";

/**
 * Reads `LLM_CREDENTIALS_KEY` and derives the keys used to encrypt the stored
 * LLM provider API token. Kept separate from the Garmin key so either secret
 * can be rotated independently.
 */
export function llmCredentialsKeyFromEnv(): Promise<CredentialKeys> {
  return credentialsKeyFromEnv("LLM_CREDENTIALS_KEY");
}
