import { describe, expect, it } from "bun:test";
import {
  CredentialCryptoError,
  decrypt,
  encrypt,
  garminCredentialsKeyFromEnv,
  keyFromRaw,
} from "./crypto.js";

/** Asserts a promise rejects with a CredentialCryptoError. */
async function expectRejectsWithCryptoError(
  promise: Promise<unknown>,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CredentialCryptoError);
    return;
  }
  throw new Error("expected promise to reject");
}

describe("credential encryption", () => {
  it("round-trips plaintext through encrypt + decrypt", async () => {
    const key = await keyFromRaw("a-secret-key");
    const ciphertext = await encrypt("my-garmin-password", key);
    expect(ciphertext).not.toContain("my-garmin-password");
    expect(await decrypt(ciphertext, key)).toBe("my-garmin-password");
  });

  it("produces different ciphertext each run (random IV)", async () => {
    const key = await keyFromRaw("a-secret-key");
    const a = await encrypt("same-value", key);
    const b = await encrypt("same-value", key);
    expect(a).not.toBe(b);
  });

  it("rejects decrypting with a different key", async () => {
    const key = await keyFromRaw("key-a");
    const other = await keyFromRaw("key-b");
    const ciphertext = await encrypt("secret", key);
    await expectRejectsWithCryptoError(decrypt(ciphertext, other));
  });

  it("rejects tampered ciphertext", async () => {
    const key = await keyFromRaw("a-secret-key");
    const ciphertext = await encrypt("secret", key);
    // Flip a character in the middle of the base64 payload.
    const tampered =
      ciphertext.slice(0, 10) +
      (ciphertext[10] === "A" ? "B" : "A") +
      ciphertext.slice(11);
    await expectRejectsWithCryptoError(decrypt(tampered, key));
  });

  it("rejects empty plaintext", async () => {
    const key = await keyFromRaw("a-secret-key");
    await expectRejectsWithCryptoError(encrypt("", key));
  });

  it("rejects ciphertext that is not base64", async () => {
    const key = await keyFromRaw("a-secret-key");
    await expectRejectsWithCryptoError(decrypt("!!!not-base64!!!", key));
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

  it("derives a key from the env value", async () => {
    process.env.GARMIN_CREDENTIALS_KEY = "env-passphrase";
    const key = await garminCredentialsKeyFromEnv();
    expect(key.extractable).toBe(false);
  });

  it("restores prior environment", () => {
    if (original === undefined) {
      delete process.env.GARMIN_CREDENTIALS_KEY;
    } else {
      process.env.GARMIN_CREDENTIALS_KEY = original;
    }
  });
});
