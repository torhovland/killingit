import { describe, expect, it } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWTPayload } from "jose";
import { Auth0Provider, jwksUrl } from "./auth0.js";

const ISSUER = "https://dev-5qhhcjppmcpsomq0.us.auth0.com/";
const AUDIENCE = "https://api.killingit.hovland.co";

// Generates a fresh RS256 key pair and a fetch stub that serves the public
// key as a JWKS, so the provider never touches the network. `sign` issues
// tokens with the *correct* key; overrides let tests vary individual claims.
async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);

  const fetchFn = (input: string) => {
    void input;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "test-1" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };

  const provider = new Auth0Provider(
    { issuer: ISSUER, audience: AUDIENCE },
    fetchFn,
  );

  // Signs with the correct key, defaulting to valid issuer/aud/sub/exp.
  // `exp` (unix seconds) and `sub: undefined` let tests target expiry/missing-sub.
  const sign = (
    overrides: JWTPayload = {},
    opts: { exp?: number; omitSub?: boolean } = {},
  ) => {
    const jwt = new SignJWT({ ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "test-1" })
      .setIssuer(overrides.iss ?? ISSUER)
      .setAudience(overrides.aud ?? AUDIENCE)
      .setIssuedAt();

    if (!opts.omitSub) {
      jwt.setSubject(overrides.sub ?? "auth0|athlete-123");
    }

    if (opts.exp !== undefined) {
      jwt.setExpirationTime(opts.exp);
    } else {
      jwt.setExpirationTime("1h");
    }

    return jwt.sign(privateKey);
  };

  return { provider, sign };
}

/** Asserts that a promise rejects. Wraps bun's `.rejects.toThrow()` in a way
 *  that satisfies both bun:test and the `await-thenable` lint rule. */
async function expectRejects(promise: Promise<unknown>): Promise<void> {
  let threw = false;
  try {
    await promise;
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
}

describe("Auth0Provider.verify", () => {
  it("accepts a valid token and returns the sub identity", async () => {
    const { provider, sign } = await setup();
    const token = await sign();

    const identity = await provider.verify(token);
    expect(identity.sub).toBe("auth0|athlete-123");
  });

  it("rejects a token signed with a different key", async () => {
    const { provider } = await setup();
    const other = await generateKeyPair("RS256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("auth0|athlete-123")
      .setExpirationTime("1h")
      .sign(other.privateKey);

    await expectRejects(provider.verify(token));
  });

  it("rejects a token with the wrong audience", async () => {
    const { provider, sign } = await setup();
    const token = await sign({ aud: "https://evil.example" });
    await expectRejects(provider.verify(token));
  });

  it("rejects a token with the wrong issuer", async () => {
    const { provider, sign } = await setup();
    const token = await sign({ iss: "https://evil.example/" });
    await expectRejects(provider.verify(token));
  });

  it("rejects a token missing a sub claim", async () => {
    const { provider, sign } = await setup();
    const token = await sign({}, { omitSub: true });
    await expectRejects(provider.verify(token));
  });

  it("rejects an expired token", async () => {
    const { provider, sign } = await setup();
    const token = await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 });
    await expectRejects(provider.verify(token));
  });

  it("rejects a malformed (non-JWT) token", async () => {
    const { provider } = await setup();
    await expectRejects(provider.verify("not-a-jwt"));
  });
});

describe("jwksUrl", () => {
  it("normalizes a trailing slash and appends the well-known path", () => {
    expect(jwksUrl("https://x.auth0.com/")).toBe(
      "https://x.auth0.com/.well-known/jwks.json",
    );
    expect(jwksUrl("https://x.auth0.com")).toBe(
      "https://x.auth0.com/.well-known/jwks.json",
    );
  });
});
