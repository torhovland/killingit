import { describe, expect, it, spyOn } from "bun:test";
import type { ApiErrorCode } from "@killingit/shared";
import { Hono } from "hono";
import { z } from "zod";
import {
  GarminCredentialsError,
  LlmCredentialsError,
} from "../coaching/feed/errors.js";
import {
  GarminAuthError,
  GarminNotConnectedError,
  GarminSidecarError,
} from "../garmin/client.js";
import { LlmModelChoiceError } from "../llm/client.js";
import {
  LlmAbortError,
  LlmAuthError,
  LlmProviderError,
  LlmRateLimitError,
  LlmTokenLimitError,
} from "../llm/openrouter.js";
import {
  apiError,
  athleteFailureMessage,
  badGateway,
  badRequest,
  conflict,
  forbidden,
  notFound,
  respondUpstreamError,
  serviceUnavailable,
  unauthorized,
  UpstreamError,
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

/** A provider failure of the kind a Garmin or OpenRouter client raises. */
class TestUpstreamError extends UpstreamError {
  constructor(
    message: string,
    options: { status?: number; code?: ApiErrorCode } = {},
  ) {
    super(message, options);
    this.name = "TestUpstreamError";
  }
}

/** One route per failure, answered by the shared upstream mapper. */
function upstreamApp(failure: () => unknown) {
  return new Hono().get("/upstream", (c) => {
    try {
      throw failure();
    } catch (err) {
      return respondUpstreamError(c, err, "[test] upstream");
    }
  });
}

async function answer(failure: () => unknown) {
  const res = await upstreamApp(failure).fetch(
    new Request("http://localhost/upstream"),
  );
  return { status: res.status, body: await res.json() };
}

describe("upstream error mapping", () => {
  it("reports the status and message the error carries", async () => {
    expect(
      await answer(
        () => new TestUpstreamError("Garmin is rate limiting", { status: 429 }),
      ),
    ).toEqual({
      status: 429,
      body: {
        error: {
          code: "too_many_requests",
          message: "Garmin is rate limiting",
        },
      },
    });
  });

  it("reports the error's own code instead of the status-derived one", async () => {
    // A credential failure uses a code its status alone cannot express: `422`
    // on its own would read as a validation failure.
    expect(
      await answer(
        () =>
          new TestUpstreamError("The Garmin login failed", {
            status: 422,
            code: "garmin_auth_failed",
          }),
      ),
    ).toMatchObject({
      status: 422,
      body: { error: { code: "garmin_auth_failed" } },
    });
  });

  it("reports a failure without a status as unavailable", async () => {
    expect(
      await answer(
        () => new TestUpstreamError("sidecar returned a malformed payload"),
      ),
    ).toEqual({
      status: 503,
      body: {
        error: {
          code: "service_unavailable",
          message: "sidecar returned a malformed payload",
        },
      },
    });
  });

  it("does not echo an impossible status", async () => {
    expect(
      await answer(
        () =>
          new TestUpstreamError("Upstream gave no answer", {
            status: 204,
          }),
      ),
    ).toMatchObject({
      status: 503,
      body: { error: { code: "service_unavailable" } },
    });
  });

  it("reports an unexpected failure as unavailable", async () => {
    expect(await answer(() => new Error("boom"))).toEqual({
      status: 503,
      body: {
        error: { code: "service_unavailable", message: "Service Unavailable" },
      },
    });
  });

  it("logs a service failure and an unexpected failure, not a client one", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await answer(
        () =>
          new TestUpstreamError("Garmin sidecar returned 502", {
            status: 502,
          }),
      );
      await answer(() => new Error("boom"));
      expect(error).toHaveBeenCalledTimes(2);

      await answer(
        () =>
          new TestUpstreamError("invalid Garmin credentials", {
            status: 422,
          }),
      );
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });
});

describe("athlete-facing failure text", () => {
  const label = "[test] failure";

  it("keeps the message of a provider failure the athlete can act on", () => {
    expect(
      athleteFailureMessage(new LlmAuthError("invalid OpenRouter API key"), {
        fallback: "The coach could not answer.",
        logLabel: label,
      }),
    ).toBe("invalid OpenRouter API key");
  });

  it("keeps the message of another athlete-facing failure", () => {
    expect(
      athleteFailureMessage(
        new LlmModelChoiceError(
          "Your daily model test/model is retired. Open Settings and choose another model.",
        ),
        { fallback: "The coach could not answer.", logLabel: label },
      ),
    ).toContain("Open Settings");
  });

  it("replaces an internal failure's message and logs it", () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const message = athleteFailureMessage(
        new Error("relation food_entries does not exist"),
        { fallback: "Something went wrong on our side.", logLabel: label },
      );

      expect(message).toBe("Something went wrong on our side.");
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[0])).toContain(label);
      expect(String(log.mock.calls[0]?.[1])).toContain(
        "relation food_entries does not exist",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("logs a provider service failure but not a provider answer", () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      athleteFailureMessage(
        new TestUpstreamError("OpenRouter returned 502", { status: 502 }),
        { fallback: "The coach is unavailable.", logLabel: label },
      );
      expect(log).toHaveBeenCalledTimes(1);

      athleteFailureMessage(new LlmAuthError("invalid OpenRouter API key"), {
        fallback: "The coach is unavailable.",
        logLabel: label,
      });
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});

describe("upstream failure statuses", () => {
  // A `401` means the request had no usable app session, so the web client
  // renews its token and retries. A third-party connection the athlete fixes in
  // Settings must never answer it (ADR 0036), or that retry is spent on a
  // failure it cannot solve.
  const failures: Array<[string, () => UpstreamError]> = [
    ["GarminSidecarError", () => new GarminSidecarError("sidecar down")],
    ["GarminAuthError", () => new GarminAuthError("invalid Garmin login")],
    ["GarminNotConnectedError", () => new GarminNotConnectedError()],
    [
      "GarminCredentialsError",
      () => new GarminCredentialsError("cannot decrypt Garmin credentials"),
    ],
    ["LlmProviderError", () => new LlmProviderError("provider down")],
    ["LlmAuthError", () => new LlmAuthError("invalid OpenRouter key")],
    ["LlmRateLimitError", () => new LlmRateLimitError("rate limited")],
    ["LlmTokenLimitError", () => new LlmTokenLimitError("truncated")],
    ["LlmAbortError", () => new LlmAbortError()],
    [
      "LlmCredentialsError",
      () => new LlmCredentialsError("cannot decrypt OpenRouter credentials"),
    ],
  ];

  it("never reports a third-party failure as a session failure", () => {
    for (const [name, make] of failures) {
      expect({ name, status: make().status }).not.toEqual({
        name,
        status: 401,
      });
    }
  });

  it("carries the code its status alone cannot express", () => {
    expect(new GarminAuthError("bad").code).toBe("garmin_auth_failed");
    expect(new GarminNotConnectedError().code).toBe("garmin_not_connected");
    expect(new LlmAuthError("bad").code).toBe("llm_key_invalid");
  });
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
