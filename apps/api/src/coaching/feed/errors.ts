import { UpstreamConfigurationError } from "../../http/upstreamError.js";

/** The stored Garmin credentials could not be decrypted. */
export class GarminCredentialsError extends UpstreamConfigurationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 503, options);
    this.name = "GarminCredentialsError";
  }
}

/** The stored LLM key could not be decrypted. */
export class LlmCredentialsError extends UpstreamConfigurationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 503, options);
    this.name = "LlmCredentialsError";
  }
}
