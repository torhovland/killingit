import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import {
  GarminCredentialsError,
  LlmCredentialsError,
} from "../coaching/feed/errors.js";
import { GarminAuthError, GarminSidecarError } from "../garmin/client.js";
import { GarminNotConnectedError } from "../garmin/credentials.js";
import {
  LlmAuthError,
  LlmProviderError,
  LlmRateLimitError,
} from "../llm/openrouter.js";
import {
  apiError,
  badGateway,
  badRequest,
  conflict,
  forbidden,
  notFound,
  respondUpstreamError,
  serviceUnavailable,
  unauthorized,
} from "./errors.js";
import { zValidator } from "./validation.js";

describe("API error helpers", () => {
  it("wrap a message in the shared error contract", async () => {
    const app = new Hono()
      .get("/bad", (c) => badRequest(c, "A search query is required"))
      .get("/missing", (c) => notFound(c, "Meal not found"))
      .get("/conflict", (c) => conflict(c, "Already answered"))
      .get("/unauthorized", (c) => unauthorized(c, "Not connected"))
      .get("/forbidden", (c) => forbidden(c, "Admins only"))
      .get("/gateway", (c) => badGateway(c, "Address search is unavailable"))
      .get("/down", (c) => serviceUnavailable(c, "Service Unavailable"));

    const cases = [
      ["/bad", 400, "bad_request"],
      ["/missing", 404, "not_found"],
      ["/conflict", 409, "conflict"],
      ["/unauthorized", 401, "unauthorized"],
      ["/forbidden", 403, "forbidden"],
      ["/gateway", 502, "bad_gateway"],
      ["/down", 503, "service_unavailable"],
    ] as const;

    for (const [path, status, code] of cases) {
      const res = await app.fetch(new Request(`http://localhost${path}`));
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toMatchObject({ error: { code } });
    }
  });

  it("derives the code from the status and keeps details", async () => {
    const app = new Hono().get("/version", (c) =>
      apiError(c, 426, "Reload to update", {
        details: { requiredVersion: 2, receivedVersion: "1" },
      }),
    );

    const res = await app.fetch(new Request("http://localhost/version"));

    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({
      error: {
        code: "api_version_mismatch",
        message: "Reload to update",
        details: { requiredVersion: 2, receivedVersion: "1" },
      },
    });
  });

  it("does not echo a non-failure upstream status", async () => {
    const app = new Hono().get("/odd", (c) =>
      apiError(c, 204, "Upstream gave no answer"),
    );

    const res = await app.fetch(new Request("http://localhost/odd"));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: {
        code: "service_unavailable",
        message: "Upstream gave no answer",
      },
    });
  });
});

describe("respondUpstreamError", () => {
  interface Case {
    err: Error;
    status: number;
    code: string;
    message: string;
    logged: boolean;
  }

  const cases: Case[] = [
    {
      err: new GarminAuthError("invalid Garmin credentials"),
      status: 409,
      code: "garmin_auth_failed",
      message: "invalid Garmin credentials",
      logged: false,
    },
    {
      err: new GarminNotConnectedError(),
      status: 409,
      code: "garmin_auth_failed",
      message: "Not connected to Garmin",
      logged: false,
    },
    {
      err: new GarminSidecarError("Garmin session rejected", 401),
      status: 409,
      code: "garmin_auth_failed",
      message: "Garmin session rejected",
      logged: false,
    },
    {
      err: new GarminSidecarError("MFA is required", 403),
      status: 403,
      code: "forbidden",
      message: "MFA is required",
      logged: false,
    },
    {
      err: new GarminSidecarError("rate limited", 429),
      status: 429,
      code: "too_many_requests",
      message: "rate limited",
      logged: false,
    },
    {
      err: new GarminSidecarError("gateway failure", 502),
      status: 502,
      code: "bad_gateway",
      message: "gateway failure",
      logged: false,
    },
    {
      err: new GarminCredentialsError(
        "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
      ),
      status: 503,
      code: "service_unavailable",
      message:
        "Garmin credentials are unavailable (check GARMIN_CREDENTIALS_KEY)",
      logged: true,
    },
    {
      err: new LlmAuthError("invalid OpenRouter API key"),
      status: 409,
      code: "llm_key_invalid",
      message: "invalid OpenRouter API key",
      logged: false,
    },
    {
      err: new LlmProviderError("OpenRouter key rejected", 401),
      status: 409,
      code: "llm_key_invalid",
      message: "OpenRouter key rejected",
      logged: false,
    },
    {
      err: new LlmRateLimitError("rate limited"),
      status: 429,
      code: "too_many_requests",
      message: "rate limited",
      logged: false,
    },
    {
      err: new LlmProviderError("provider failure", 500),
      status: 500,
      code: "internal_error",
      message: "provider failure",
      logged: false,
    },
    {
      err: new LlmCredentialsError(
        "OpenRouter credentials are unavailable (check LLM_CREDENTIALS_KEY)",
      ),
      status: 503,
      code: "service_unavailable",
      message:
        "OpenRouter credentials are unavailable (check LLM_CREDENTIALS_KEY)",
      logged: true,
    },
    {
      err: new GarminSidecarError("could not reach Garmin sidecar"),
      status: 503,
      code: "service_unavailable",
      message: "Service Unavailable",
      logged: true,
    },
    {
      err: new LlmProviderError("the completion was cancelled"),
      status: 503,
      code: "service_unavailable",
      message: "Service Unavailable",
      logged: true,
    },
    {
      err: new Error("database down"),
      status: 503,
      code: "service_unavailable",
      message: "Service Unavailable",
      logged: true,
    },
  ];

  for (const testCase of cases) {
    it(`maps ${testCase.err.name} to ${testCase.status}`, async () => {
      const logged: unknown[] = [];
      const app = new Hono().get("/failure", (c) =>
        respondUpstreamError(c, testCase.err, {
          log: (failure) => logged.push(failure),
        }),
      );

      const res = await app.fetch(new Request("http://localhost/failure"));

      expect(res.status).toBe(testCase.status);
      expect(await res.json()).toEqual({
        error: { code: testCase.code, message: testCase.message },
      });
      expect(logged).toEqual(testCase.logged ? [testCase.err] : []);
    });
  }
});

describe("validating zValidator wrapper", () => {
  const app = new Hono().post(
    "/items",
    zValidator("json", z.object({ name: z.string() })),
    (c) => c.json(c.req.valid("json")),
  );

  it("passes valid input through to the handler", async () => {
    const res = await app.fetch(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Oats" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Oats" });
  });

  it("reports invalid input with the error contract", async () => {
    const res = await app.fetch(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 42 }),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: {
        code: string;
        message: string;
        details?: { issues?: unknown[] };
      };
    };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toBe("The request is not valid");
    expect(body.error.details?.issues?.length).toBeGreaterThan(0);
  });
});
