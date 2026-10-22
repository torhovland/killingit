import type { UserRole } from "@killingit/shared";
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { UserStore } from "../users/store.js";
import { requireAdmin, requireAuth } from "./middleware.js";
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

function storeWithRole(role: UserRole): UserStore {
  return {
    ensureUser: (sub) =>
      Promise.resolve({
        id: 1,
        sub,
        role,
        timezone: null,
        createdAt: new Date(0),
      }),
    updateTimezone: (sub, timezone) =>
      Promise.resolve({
        id: 1,
        sub,
        role,
        timezone,
        createdAt: new Date(0),
      }),
  };
}

function appWithAdmin(store: UserStore) {
  const app = new Hono();
  app.use(
    "*",
    requireAuth(() => validProvider),
  );
  app.use("*", requireAdmin(store));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

const authedRequest = () =>
  new Request("http://localhost/", {
    headers: { authorization: "Bearer anything" },
  });

describe("requireAdmin", () => {
  it("allows an admin", async () => {
    const res = await appWithAdmin(storeWithRole("admin")).fetch(
      authedRequest(),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a member with 403", async () => {
    const res = await appWithAdmin(storeWithRole("member")).fetch(
      authedRequest(),
    );
    expect(res.status).toBe(403);
  });

  it("returns 503 when the account cannot be resolved", async () => {
    const store: UserStore = {
      ensureUser: () => Promise.reject(new Error("database down")),
      updateTimezone: () => Promise.reject(new Error("database down")),
    };
    const res = await appWithAdmin(store).fetch(authedRequest());
    expect(res.status).toBe(503);
  });
});
