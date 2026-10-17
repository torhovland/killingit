import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import app from "../index";

const ISSUER = "https://dev-5qhhcjppmcpsomq0.us.auth0.com/";
const AUDIENCE = "https://api.killingit.hovland.co";

// The app module caches its auth provider (and thus the JWKS fetch) across
// requests, so a single key pair is generated once and served by the stub for
// the whole file. This keeps the provider's cached JWKS consistent with the
// tokens issued here.
let validToken: string;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);

  process.env.AUTH0_ISSUER = ISSUER;
  process.env.AUTH0_AUDIENCE = AUDIENCE;

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "test-1" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )) as unknown as typeof fetch;

  validToken = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject("auth0|athlete-123")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AUTH0_ISSUER;
  delete process.env.AUTH0_AUDIENCE;
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

  it("returns the identity sub with a valid token", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/me", {
        headers: { authorization: `Bearer ${validToken}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sub: string };
    expect(body.sub).toBe("auth0|athlete-123");
  });
});
