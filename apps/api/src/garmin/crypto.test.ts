import { describe, expect, it } from "bun:test";
import {
  credentialsKeyFromEnv,
  decrypt,
  encrypt,
  type CredentialKeys,
} from "../crypto/credentials.js";
import { garminCredentialsKeyFromEnv } from "./crypto.js";

/** The account that owns the ciphertexts in these tests. */
const USER_ID = 7;

/** A ciphertext written before the HKDF key and the account binding. */
const LEGACY_PASSPHRASE = "legacy-passphrase";
const LEGACY_CIPHERTEXT =
  "AAECAwQFBgcICQoLKDm1RnoWp7dE4erK4aL+GZC1bZccIJiuMTQO55TQZ4qWbsKNUDc=";

/** Derives keys from a raw secret through the environment entry point. */
function keyFromRaw(raw: string): Promise<CredentialKeys> {
  process.env.TEST_CREDENTIALS_KEY = raw;
  return credentialsKeyFromEnv("TEST_CREDENTIALS_KEY");
}

/** Asserts a promise rejects with the credential-crypto failure. */
async function expectRejectsWithCryptoError(
  promise: Promise<unknown>,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("CredentialCryptoError");
    return;
  }
  throw new Error("expected promise to reject");
}

describe("credential encryption", () => {
  it("round-trips plaintext through encrypt + decrypt", async () => {
    const keys = await keyFromRaw("a-secret-key");
    const ciphertext = await encrypt("my-garmin-password", keys, USER_ID);
    expect(ciphertext.startsWith("v2:")).toBe(true);
    expect(ciphertext).not.toContain("my-garmin-password");
    expect(await decrypt(ciphertext, keys, USER_ID)).toBe("my-garmin-password");
  });

  it("binds a ciphertext to the account that owns it", async () => {
    const keys = await keyFromRaw("a-secret-key");
    const ciphertext = await encrypt("my-garmin-password", keys, 1);
    await expectRejectsWithCryptoError(decrypt(ciphertext, keys, 2));
  });

  it("decrypts a ciphertext written before the version prefix", async () => {
    const keys = await keyFromRaw(LEGACY_PASSPHRASE);
    expect(await decrypt(LEGACY_CIPHERTEXT, keys, USER_ID)).toBe(
      "legacy-garmin-password",
    );
  });

  it("rejects a legacy ciphertext under a different key", async () => {
    const keys = await keyFromRaw("different-passphrase");
    await expectRejectsWithCryptoError(
      decrypt(LEGACY_CIPHERTEXT, keys, USER_ID),
    );
  });

  it("produces different ciphertext each run (random IV)", async () => {
    const keys = await keyFromRaw("a-secret-key");
    const a = await encrypt("same-value", keys, USER_ID);
    const b = await encrypt("same-value", keys, USER_ID);
    expect(a).not.toBe(b);
  });

  it("rejects decrypting with a different key", async () => {
    const keys = await keyFromRaw("key-a");
    const other = await keyFromRaw("key-b");
    const ciphertext = await encrypt("secret", keys, USER_ID);
    await expectRejectsWithCryptoError(decrypt(ciphertext, other, USER_ID));
  });

  it("rejects tampered ciphertext", async () => {
    const keys = await keyFromRaw("a-secret-key");
    const ciphertext = await encrypt("secret", keys, USER_ID);
    const payload = ciphertext.slice("v2:".length);
    // Flip a character in the middle of the base64 payload.
    const tampered = `v2:${payload.slice(0, 10)}${
      payload[10] === "A" ? "B" : "A"
    }${payload.slice(11)}`;
    await expectRejectsWithCryptoError(decrypt(tampered, keys, USER_ID));
  });

  it("rejects empty plaintext", async () => {
    const keys = await keyFromRaw("a-secret-key");
    await expectRejectsWithCryptoError(encrypt("", keys, USER_ID));
  });

  it("rejects ciphertext that is not base64", async () => {
    const keys = await keyFromRaw("a-secret-key");
    await expectRejectsWithCryptoError(
      decrypt("!!!not-base64!!!", keys, USER_ID),
    );
  });
});

describe("credential key derivation", () => {
  it("caches the keys derived for one environment value", async () => {
    const first = await keyFromRaw("cached-secret");
    const second = await keyFromRaw("cached-secret");
    expect(second).toBe(first);
  });

  it("derives fresh keys when the environment value changes", async () => {
    const first = await keyFromRaw("first-secret");
    const second = await keyFromRaw("second-secret");
    expect(second).not.toBe(first);
  });
});

describe("garminCredentialsKeyFromEnv", () => {
  const original = process.env.GARMIN_CREDENTIALS_KEY;

  it("throws a descriptive error when the key is missing", () => {
    delete process.env.GARMIN_CREDENTIALS_KEY;
    expect(() => garminCredentialsKeyFromEnv()).toThrow(
      /GARMIN_CREDENTIALS_KEY/,
    );
  });

  it("derives a non-extractable key from the env value", async () => {
    process.env.GARMIN_CREDENTIALS_KEY = "env-passphrase";
    const keys = await garminCredentialsKeyFromEnv();
    expect(keys.current.extractable).toBe(false);
  });

  it("restores prior environment", () => {
    if (original === undefined) {
      delete process.env.GARMIN_CREDENTIALS_KEY;
    } else {
      process.env.GARMIN_CREDENTIALS_KEY = original;
    }
  });
});
