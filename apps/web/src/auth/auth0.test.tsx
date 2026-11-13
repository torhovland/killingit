import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { MissingRefreshTokenError } from "@auth0/auth0-react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthState } from "./auth0";
import { SessionExpiredError } from "./session";

/**
 * Exercises both implementations of `useAuth`. `AUTH0_CONFIGURED` is read from
 * `import.meta.env` when the module loads, so the adapter is imported twice: an
 * unconfigured instance (the build without Auth0) and a configured instance
 * whose environment is set below. Bun evaluates each query-string specifier
 * separately and attributes both to `auth0.ts`.
 *
 * Owning the module here also keeps the coverage denominator stable: other
 * suites replace the `./auth` barrel with a process-global mock, so whether the
 * real adapter loaded used to depend on test ordering.
 */

const env = {
  VITE_AUTH0_DOMAIN: process.env.VITE_AUTH0_DOMAIN,
  VITE_AUTH0_CLIENT_ID: process.env.VITE_AUTH0_CLIENT_ID,
  VITE_AUTH0_AUDIENCE: process.env.VITE_AUTH0_AUDIENCE,
};

interface ProviderUser {
  sub?: string;
  given_name?: string;
  name?: string;
  nickname?: string;
  email?: string;
  picture?: string;
}

interface ProviderSession {
  user?: ProviderUser | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  getAccessTokenSilently: (options?: unknown) => Promise<string>;
  loginWithRedirect: (options?: unknown) => Promise<void>;
  logout: (options?: unknown) => Promise<void>;
}

const loginCalls: unknown[] = [];
const logoutCalls: unknown[] = [];
const tokenCalls: unknown[] = [];

/**
 * A signed-out provider by default, so a suite that loads the real adapter
 * while this file's environment is set sees the same signed-out session the
 * unconfigured build returns.
 */
function providerSession(
  overrides: Partial<ProviderSession> = {},
): ProviderSession {
  return {
    user: undefined,
    isAuthenticated: false,
    isLoading: false,
    getAccessTokenSilently: (options) => {
      tokenCalls.push(options);
      return Promise.resolve("access-token");
    },
    loginWithRedirect: (options) => {
      loginCalls.push(options);
      return Promise.resolve();
    },
    logout: (options) => {
      logoutCalls.push(options);
      return Promise.resolve();
    },
    ...overrides,
  };
}

const SIGNED_IN: Partial<ProviderSession> = {
  user: { sub: "auth|1", given_name: "Ada", picture: "https://img/ada" },
  isAuthenticated: true,
};

let provider = providerSession();

const realAuth0 = await import("@auth0/auth0-react");

await mock.module("@auth0/auth0-react", () => ({
  ...realAuth0,
  useAuth0: () => provider,
}));

const windowStub = {
  location: { pathname: "/fitness", origin: "https://app.example.com" },
};
const originalWindow = (globalThis as { window?: unknown }).window;
(globalThis as { window?: unknown }).window = windowStub;

delete process.env.VITE_AUTH0_DOMAIN;
delete process.env.VITE_AUTH0_CLIENT_ID;
delete process.env.VITE_AUTH0_AUDIENCE;
const noopSpecifier = "./auth0.ts?noop";
const noopModule = (await import(noopSpecifier)) as typeof import("./auth0");

process.env.VITE_AUTH0_DOMAIN = "dev-tenant.us.auth0.com";
process.env.VITE_AUTH0_CLIENT_ID = "client-id";
process.env.VITE_AUTH0_AUDIENCE = "https://api.example.com";
const configuredSpecifier = "./auth0.ts?configured";
const configuredModule = (await import(
  configuredSpecifier
)) as typeof import("./auth0");

afterAll(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  mock.restore();
});

beforeEach(() => {
  provider = providerSession();
  loginCalls.length = 0;
  logoutCalls.length = 0;
  tokenCalls.length = 0;
});

/** Reads the session a hook returns by rendering it once. */
function readSession(hook: () => AuthState): AuthState {
  const holder: { session: AuthState | null } = { session: null };
  function Probe(): null {
    holder.session = hook();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  const session = holder.session;
  if (session === null) {
    throw new Error("The probe did not read a session.");
  }
  return session;
}

describe("useAuth without an Auth0 configuration", () => {
  it("returns a stable signed-out session", () => {
    const first = readSession(noopModule.useAuth);
    const second = readSession(noopModule.useAuth);

    expect(first.isAuthenticated).toBe(false);
    expect(first.isLoading).toBe(false);
    expect(first.sub).toBeNull();
    expect(first.firstName).toBeNull();
    expect(first.picture).toBeNull();
    expect(typeof first.login).toBe("function");
    expect(typeof first.logout).toBe("function");
    expect(typeof first.getToken).toBe("function");
    expect(first).toBe(second);
  });

  it("never calls the provider and always has no token", async () => {
    const session = readSession(noopModule.useAuth);

    await session.login();
    await session.logout();
    expect(await session.getToken()).toBeUndefined();
    expect(await session.getToken({ forceRefresh: true })).toBeUndefined();
    expect(loginCalls).toHaveLength(0);
    expect(logoutCalls).toHaveLength(0);
    expect(tokenCalls).toHaveLength(0);
  });
});

describe("useAuth with an Auth0 configuration", () => {
  it("exposes the provider session", () => {
    provider = providerSession(SIGNED_IN);

    const session = readSession(configuredModule.useAuth);

    expect(session.isAuthenticated).toBe(true);
    expect(session.isLoading).toBe(false);
    expect(session.sub).toBe("auth|1");
    expect(session.firstName).toBe("Ada");
    expect(session.picture).toBe("https://img/ada");
  });

  it("falls back through the profile fields for the first name", () => {
    const firstName = (
      user: ProviderUser | undefined,
    ): string | null | undefined => {
      provider = providerSession({ ...SIGNED_IN, user });
      return readSession(configuredModule.useAuth).firstName;
    };

    expect(firstName(undefined)).toBeNull();
    expect(firstName({ given_name: "  " })).toBeNull();
    expect(firstName({ name: "Grace Hopper" })).toBe("Grace");
    expect(firstName({ nickname: "Amazing Grace" })).toBe("Amazing Grace");
    expect(firstName({ email: "katherine.johnson@nasa.gov" })).toBe(
      "katherine.johnson",
    );
  });

  it("signs in with the API audience and the current page as the return path", async () => {
    const session = readSession(configuredModule.useAuth);

    await session.login();

    expect(loginCalls).toEqual([
      {
        authorizationParams: {
          audience: "https://api.example.com",
          scope: "openid profile email read:profile read:workouts",
        },
        appState: { returnTo: "/fitness" },
      },
    ]);
  });

  it("signs out back to the site origin", async () => {
    const session = readSession(configuredModule.useAuth);

    await session.logout();

    expect(logoutCalls).toEqual([
      { logoutParams: { returnTo: "https://app.example.com" } },
    ]);
  });

  it("has no token while signed out", async () => {
    provider = providerSession({ isAuthenticated: false });

    const session = readSession(configuredModule.useAuth);

    expect(await session.getToken()).toBeUndefined();
    expect(tokenCalls).toHaveLength(0);
  });

  it("asks for the API audience and scope when renewing the token", async () => {
    provider = providerSession(SIGNED_IN);

    const session = readSession(configuredModule.useAuth);

    expect(await session.getToken()).toBe("access-token");
    expect(tokenCalls).toEqual([
      {
        authorizationParams: {
          audience: "https://api.example.com",
          scope: "openid profile email read:profile read:workouts",
        },
      },
    ]);
  });

  it("skips the token cache for a forced refresh", async () => {
    provider = providerSession(SIGNED_IN);

    const session = readSession(configuredModule.useAuth);

    await session.getToken({ forceRefresh: true });

    expect(tokenCalls).toEqual([
      {
        cacheMode: "off",
        authorizationParams: {
          audience: "https://api.example.com",
          scope: "openid profile email read:profile read:workouts",
        },
      },
    ]);
  });

  it("propagates a transient token failure", async () => {
    const failure = new Error("network down");
    provider = providerSession({
      ...SIGNED_IN,
      getAccessTokenSilently: () => Promise.reject(failure),
    });

    const session = readSession(configuredModule.useAuth);

    const error = await session.getToken().catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(logoutCalls).toHaveLength(0);
  });

  it("drops a session that can never renew", async () => {
    const failure = new MissingRefreshTokenError(
      "https://api.example.com",
      "openid offline_access",
    );
    provider = providerSession({
      ...SIGNED_IN,
      getAccessTokenSilently: () => Promise.reject(failure),
    });

    const session = readSession(configuredModule.useAuth);

    const error = await session.getToken().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SessionExpiredError);
    expect(logoutCalls).toEqual([{ openUrl: false }]);
  });
});
