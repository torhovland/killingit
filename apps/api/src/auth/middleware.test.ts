import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requireAuth } from "./middleware.js";
import type { AuthProvider } from "./provider.js";
import { AuthVerificationError } from "./provider.js";

function appWith(provider: AuthProvider) {
  const app = new Hono();
  app.use(
    "*",
    requireAuth(() => provider),
  );
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

const validProvider: AuthProvider = {
  verify: () => Promise.resolve({ sub: "athlete-123" }),
};

describe("requireAuth", () => {
  it("returns 401 when the provider rejects with AuthVerificationError", async () => {
    const provider: AuthProvider = {
      verify: () => Promise.reject(new AuthVerificationError("bad token")),
    };
    const res = await appWith(provider).fetch(
      new Request("http://localhost/", {
        headers: { authorization: "Bearer anything" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 503 when the provider fails for an infrastructure reason", async () => {
    const provider: AuthProvider = {
      verify: () => Promise.reject(new Error("jwks unreachable")),
    };
    const res = await appWith(provider).fetch(
      new Request("http://localhost/", {
        headers: { authorization: "Bearer anything" },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("accepts a valid token and runs the handler", async () => {
    const res = await appWith(validProvider).fetch(
      new Request("http://localhost/", {
        headers: { authorization: "Bearer anything" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
