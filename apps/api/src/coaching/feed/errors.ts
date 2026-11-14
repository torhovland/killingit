import { UpstreamError } from "../../http/errors.js";

/**
 * The stored Garmin credentials could not be decrypted. A key misconfiguration
 * is a server fault, not a connection the athlete can repair, so it keeps the
 * service-failure status `UpstreamError` defaults to. See ADR 0035.
 */
export class GarminCredentialsError extends UpstreamError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GarminCredentialsError";
  }
}

/** The stored LLM key could not be decrypted, for the same reason. */
export class LlmCredentialsError extends UpstreamError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmCredentialsError";
  }
}
