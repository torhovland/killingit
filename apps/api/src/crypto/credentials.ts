/**
 * App-level secret encryption shared by integrations that store credentials
 * at rest (Garmin username/password, LLM API keys).
 *
 * Values are encrypted with AES-256-GCM using a key derived from an environment
 * secret. The raw secret (UTF-8) is hashed with SHA-256 to a fixed 32-byte key,
 * so operators can paste any passphrase rather than a must-be-exactly-32-bytes
 * hex blob.
 *
 * The ciphertext format is `<12-byte IV><ciphertext><16-byte auth tag>`,
 * base64-encoded for storage. Decryption re-verifies the auth tag, so tampered
 * or truncated ciphertext raises `CredentialCryptoError` rather than returning
 * garbage.
 */

/** Raised when encryption/decryption cannot proceed (bad key, tampered data). */
export class CredentialCryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CredentialCryptoError";
  }
}

/**
 * Reads an encryption key from the environment and derives a 32-byte AES key.
 * Throws a descriptive error naming the env var so callers can surface a clear
 * config failure rather than a generic 500.
 */
export function credentialsKeyFromEnv(varName: string): Promise<CryptoKey> {
  const raw = process.env[varName]?.trim();
  if (!raw) {
    throw new Error(`${varName} must be set to enable this integration`);
  }
  return keyFromRaw(raw);
}

/** Derives the raw 32-byte AES-GCM key from an arbitrary secret string. */
async function rawKeyBytes(raw: string): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return new Uint8Array(digest);
}

/** Builds (and caches) the derived CryptoKey for the given raw secret. */
export async function keyFromRaw(raw: string): Promise<CryptoKey> {
  const bytes = await rawKeyBytes(raw);
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypts a plaintext string, returning base64(`iv || ciphertext || authTag`).
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<string> {
  if (plaintext === "") {
    throw new CredentialCryptoError("cannot encrypt an empty value");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const buf = new Uint8Array(ciphertext);
  // AES-GCM output is ciphertext followed by the 16-byte auth tag.
  const out = new Uint8Array(iv.length + buf.length);
  out.set(iv, 0);
  out.set(buf, iv.length);
  return base64Encode(out);
}

/**
 * Decrypts a value produced by {@link encrypt}, returning the plaintext string.
 * Throws {@link CredentialCryptoError} on a missing key, malformed input, or
 * an auth-tag mismatch (tampering).
 */
export async function decrypt(
  ciphertext: string,
  key: CryptoKey,
): Promise<string> {
  const bytes = base64Decode(ciphertext);
  if (bytes.length < 12 + 16) {
    throw new CredentialCryptoError("ciphertext too short to be valid");
  }
  const iv = bytes.slice(0, 12);
  const data = bytes.slice(12);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  } catch (cause) {
    throw new CredentialCryptoError(
      "decryption failed (bad key or tampered data)",
      {
        cause,
      },
    );
  }
  return new TextDecoder().decode(plaintext);
}

function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

function base64Decode(s: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(s);
  } catch (cause) {
    throw new CredentialCryptoError("ciphertext is not valid base64", {
      cause,
    });
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
