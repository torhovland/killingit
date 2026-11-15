/**
 * App-level secret encryption shared by integrations that store credentials
 * at rest (Garmin username/password, LLM API keys).
 *
 * Values are encrypted with AES-256-GCM using an environment secret. The
 * secret is stretched with HKDF-SHA-256 rather than used as an AES key
 * directly, so operators can paste any passphrase rather than a
 * must-be-exactly-32-bytes hex blob. The owning account id is authenticated as
 * AES-GCM additional data, so a ciphertext moved to another account's row
 * fails to decrypt rather than exposing the original plaintext.
 *
 * The current ciphertext format is
 * `v2:` + base64(`<12-byte IV><ciphertext><16-byte auth tag>`). A ciphertext
 * without the prefix was written before this format: it is decrypted with the
 * original SHA-256-derived key and no additional data, and is replaced with a
 * `v2:` ciphertext the next time the credential is written. See
 * `docs/specs/credential-encryption.md` and ADR 0060.
 */

/** Marks a ciphertext written with the HKDF key and the account binding. */
const CURRENT_FORMAT_PREFIX = "v2:";

/** Non-secret HKDF salt; the environment secret is the input key material. */
const HKDF_SALT = new TextEncoder().encode("killingit-credentials-salt");

/** Raised when encryption/decryption cannot proceed (bad key, tampered data). */
class CredentialCryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CredentialCryptoError";
  }
}

/**
 * The two AES keys derived from one environment secret: `current` for the
 * versioned format, and `legacy` to read ciphertexts written before it.
 */
export interface CredentialKeys {
  /** HKDF-derived key for ciphertexts in the current format. */
  readonly current: CryptoKey;
  /** SHA-256-derived key for ciphertexts without the version prefix. */
  readonly legacy: CryptoKey;
}

interface CachedKeys {
  /** The environment value the keys were derived from, to detect rotation. */
  raw: string;
  keys: Promise<CredentialKeys>;
}

/** Derived keys per environment variable, invalidated when its value changes. */
const keyCache = new Map<string, CachedKeys>();

/**
 * Reads an encryption key from the environment and derives the AES keys.
 * Throws a descriptive error naming the env var so callers can surface a clear
 * config failure rather than a generic 500.
 */
export function credentialsKeyFromEnv(
  varName: string,
): Promise<CredentialKeys> {
  const raw = process.env[varName]?.trim();
  if (!raw) {
    throw new Error(`${varName} must be set to enable this integration`);
  }
  const cached = keyCache.get(varName);
  if (cached?.raw === raw) {
    return cached.keys;
  }
  const keys = deriveKeys(raw, varName).catch((cause: unknown) => {
    // A failed derivation must not be cached, or every later request would
    // keep seeing the same rejected promise.
    if (keyCache.get(varName)?.raw === raw) {
      keyCache.delete(varName);
    }
    throw cause;
  });
  keyCache.set(varName, { raw, keys });
  return keys;
}

/** Derives the current and legacy AES keys from one raw environment secret. */
async function deriveKeys(
  raw: string,
  varName: string,
): Promise<CredentialKeys> {
  const [current, legacy] = await Promise.all([
    deriveCurrentKey(raw, varName),
    deriveLegacyKey(raw),
  ]);
  return { current, legacy };
}

/**
 * HKDF-derives the current AES-GCM key. The info string binds the key to the
 * integration's env var, so the same passphrase pasted into two integrations
 * still produces different keys.
 */
async function deriveCurrentKey(
  raw: string,
  varName: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(raw),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: new TextEncoder().encode(`killingit-credentials:${varName}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Derives the key used by ciphertexts written before the version prefix. */
async function deriveLegacyKey(raw: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(digest),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts a plaintext string for the given account, returning
 * `v2:` + base64(`iv || ciphertext || authTag`).
 */
export async function encrypt(
  plaintext: string,
  keys: CredentialKeys,
  userId: number,
): Promise<string> {
  if (plaintext === "") {
    throw new CredentialCryptoError("cannot encrypt an empty value");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(userId) },
    keys.current,
    new TextEncoder().encode(plaintext),
  );
  const buf = new Uint8Array(ciphertext);
  // AES-GCM output is ciphertext followed by the 16-byte auth tag.
  const out = new Uint8Array(iv.length + buf.length);
  out.set(iv, 0);
  out.set(buf, iv.length);
  return CURRENT_FORMAT_PREFIX + base64Encode(out);
}

/**
 * Decrypts a value produced by {@link encrypt} for the given account, or one
 * written before the version prefix. Throws {@link CredentialCryptoError} on a
 * missing key, malformed input, an auth-tag mismatch (tampering), or a
 * ciphertext that belongs to another account.
 */
export async function decrypt(
  ciphertext: string,
  keys: CredentialKeys,
  userId: number,
): Promise<string> {
  if (ciphertext.startsWith(CURRENT_FORMAT_PREFIX)) {
    return decryptBytes(
      base64Decode(ciphertext.slice(CURRENT_FORMAT_PREFIX.length)),
      keys.current,
      additionalData(userId),
    );
  }
  // No prefix is a ciphertext from before the account binding: the original
  // format has no authenticated data.
  return decryptBytes(base64Decode(ciphertext), keys.legacy);
}

/** Authenticates the ciphertext to the account row that owns it. */
function additionalData(userId: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`user:${userId}`);
}

/** Decrypts one `iv || ciphertext || authTag` payload. */
async function decryptBytes(
  bytes: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  aad?: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (bytes.length < 12 + 16) {
    throw new CredentialCryptoError("ciphertext too short to be valid");
  }
  const iv = new Uint8Array(bytes.subarray(0, 12));
  const data = new Uint8Array(bytes.subarray(12));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      data,
    );
  } catch (cause) {
    throw new CredentialCryptoError(
      "decryption failed (bad key, wrong account or tampered data)",
      { cause },
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

function base64Decode(s: string): Uint8Array<ArrayBuffer> {
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
