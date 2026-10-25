import { describe, expect, it } from "bun:test";
import { auth0ProviderOptions } from "./config";

const base = {
  domain: "dev-tenant.us.auth0.com",
  clientId: "client-id",
  redirectUri: "https://app.example.com",
};

describe("auth0ProviderOptions", () => {
  it("returns null when Auth0 is not configured", () => {
    expect(auth0ProviderOptions({ redirectUri: base.redirectUri })).toBeNull();
    expect(auth0ProviderOptions({ ...base, domain: "" })).toBeNull();
    expect(auth0ProviderOptions({ ...base, clientId: "" })).toBeNull();
  });

  it("persists the session in localStorage and renews it with refresh tokens", () => {
    const options = auth0ProviderOptions(base);

    expect(options).toMatchObject({
      domain: base.domain,
      clientId: base.clientId,
      cacheLocation: "localstorage",
      useRefreshTokens: true,
      useRefreshTokensFallback: true,
      authorizationParams: { redirect_uri: base.redirectUri },
    });
  });

  it("requests the API audience only when one is configured", () => {
    const audience = "https://api.example.com";
    const withAudience = auth0ProviderOptions({ ...base, audience });
    const withoutAudience = auth0ProviderOptions(base);

    expect(withAudience?.authorizationParams?.audience).toBe(audience);
    expect(withoutAudience?.authorizationParams?.audience).toBeUndefined();
  });
});
