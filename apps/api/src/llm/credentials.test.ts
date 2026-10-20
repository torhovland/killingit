import { afterEach, describe, expect, it } from "bun:test";
import { llmCredentialsKeyFromEnv } from "./credentials.js";

const original = process.env.LLM_CREDENTIALS_KEY;

afterEach(() => {
  if (original === undefined) {
    delete process.env.LLM_CREDENTIALS_KEY;
  } else {
    process.env.LLM_CREDENTIALS_KEY = original;
  }
});

describe("llmCredentialsKeyFromEnv", () => {
  it("names the missing environment variable", () => {
    delete process.env.LLM_CREDENTIALS_KEY;
    expect(() => llmCredentialsKeyFromEnv()).toThrow(/LLM_CREDENTIALS_KEY/);
  });

  it("derives a non-extractable AES key", async () => {
    process.env.LLM_CREDENTIALS_KEY = "a-test-passphrase";
    const key = await llmCredentialsKeyFromEnv();
    expect(key.extractable).toBe(false);
  });
});
