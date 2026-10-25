import { beforeAll, describe, expect, it } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Auth0Provider } from "../auth/auth0.js";
import { createApp } from "../index.js";
import type { UserStore } from "../users/store.js";

const ISSUER = "https://dev-5qhhcjppmcpsomq0.us.auth0.com/";
const AUDIENCE = "https://api.killingit.hovland.co";

// The provider is injected with a fetch stub that serves the public key as a
// JWKS, so the test never touches the network. The user store is faked so the
// authenticated path stays database-free in CI.
let validToken: string;
let app: ReturnType<typeof createApp>;
let signedInSub = "";

const userStore: UserStore = {
  ensureUser: (sub) =>
    Promise.resolve({
      id: 1,
      sub,
      role: "admin",
      timezone: null,
      location: null,
      createdAt: new Date(0),
    }),
  getById: (id) =>
    Promise.resolve({
      id,
      sub: signedInSub || "auth0|athlete-123",
      role: "admin",
      timezone: null,
      location: null,
      createdAt: new Date(0),
    }),
  updateSettings: (sub, settings) =>
    Promise.resolve({
      id: 1,
      sub,
      role: "admin",
      timezone: settings.timezone !== undefined ? settings.timezone : null,
      location: settings.location !== undefined ? settings.location : null,
      createdAt: new Date(0),
    }),
};

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);

  const provider = new Auth0Provider(
    { issuer: ISSUER, audience: AUDIENCE },
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "test-1" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
  );

  app = createApp({ authProvider: provider, userStore });

  signedInSub = "auth0|athlete-123";
  validToken = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(signedInSub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
});

describe("GET /api/me", () => {
  it("returns 401 without an Authorization header", async () => {
    const res = await app.fetch(new Request("http://localhost/api/me"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with a malformed bearer token", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/me", {
        headers: { authorization: "Bearer not-a-jwt" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 with a token signed by an unknown key", async () => {
    const other = await generateKeyPair("RS256");
    const bad = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("auth0|intruder")
      .setExpirationTime("1h")
      .sign(other.privateKey);

    const res = await app.fetch(
      new Request("http://localhost/api/me", {
        headers: { authorization: `Bearer ${bad}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns the identity sub and role with a valid token", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/me", {
        headers: { authorization: `Bearer ${validToken}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sub: string;
      role: string;
      timezone: string | null;
    };
    expect(body.sub).toBe(signedInSub);
    expect(body.role).toBe("admin");
    expect(body.timezone).toBeNull();
  });

  it("saves the athlete's time zone", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/me", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${validToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ timezone: "Europe/Oslo" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { timezone: string | null };
    expect(body.timezone).toBe("Europe/Oslo");
  });

  it("rejects an unknown time zone", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/me", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${validToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ timezone: "Mars/Olympus_Mons" }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("saves and clears the athlete's location", async () => {
    const saved = await app.fetch(
      new Request("http://localhost/api/me", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${validToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          location: {
            latitude: 59.91,
            longitude: 10.75,
            name: "Oslo, Norway",
          },
        }),
      }),
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as {
      location: { latitude: number; longitude: number; name: string } | null;
    };
    expect(body.location).toEqual({
      latitude: 59.91,
      longitude: 10.75,
      name: "Oslo, Norway",
    });

    const cleared = await app.fetch(
      new Request("http://localhost/api/me", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${validToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ location: null }),
      }),
    );
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as {
      location: unknown;
    };
    expect(clearedBody.location).toBeNull();
  });

  it("rejects out-of-range coordinates and an empty patch", async () => {
    for (const body of [
      { location: { latitude: 91, longitude: 10 } },
      { location: { latitude: 10, longitude: 181 } },
      {},
    ]) {
      const response = await app.fetch(
        new Request("http://localhost/api/me", {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${validToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(400);
    }
  });
});
