import { describe, expect, it } from "bun:test";
import { garminCredentialsKeyFromEnv } from "./credentials.js";

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
