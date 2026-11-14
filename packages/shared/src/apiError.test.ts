import { describe, expect, it } from "bun:test";
import { apiErrorResponseSchema } from "./apiError.js";

describe("apiErrorResponseSchema", () => {
  it("accepts a minimal failure with a code and message", () => {
    expect(
      apiErrorResponseSchema.parse({
        error: { code: "not_found", message: "Meal not found" },
      }),
    ).toEqual({ error: { code: "not_found", message: "Meal not found" } });
  });

  it("keeps optional structured details", () => {
    expect(
      apiErrorResponseSchema.parse({
        error: {
          code: "validation_failed",
          message: "The request is not valid",
          details: { issues: [{ path: ["name"], message: "Required" }] },
        },
      }),
    ).toEqual({
      error: {
        code: "validation_failed",
        message: "The request is not valid",
        details: { issues: [{ path: ["name"], message: "Required" }] },
      },
    });
  });

  it("accepts the third-party credential failure codes", () => {
    expect(
      apiErrorResponseSchema.parse({
        error: {
          code: "garmin_auth_failed",
          message: "Not connected to Garmin",
        },
      }),
    ).toEqual({
      error: { code: "garmin_auth_failed", message: "Not connected to Garmin" },
    });
    expect(
      apiErrorResponseSchema.parse({
        error: {
          code: "llm_key_invalid",
          message: "invalid OpenRouter API key",
        },
      }),
    ).toEqual({
      error: { code: "llm_key_invalid", message: "invalid OpenRouter API key" },
    });
  });

  it("rejects an unknown code or a missing message", () => {
    expect(
      apiErrorResponseSchema.safeParse({
        error: { code: "teapot", message: "Nope" },
      }).success,
    ).toBe(false);
    expect(
      apiErrorResponseSchema.safeParse({ error: { code: "bad_request" } })
        .success,
    ).toBe(false);
  });
});
