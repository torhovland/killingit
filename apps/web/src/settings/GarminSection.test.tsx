import { afterAll, describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthState } from "../auth";

const { SessionExpiredError } = await import("../auth/session");

/** Stable identity, as the real `useAuth` contract promises. */
const auth: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve("token"),
};

await mock.module("../auth", () => ({
  SessionExpiredError,
  useAuth: () => auth,
}));

afterAll(() => {
  mock.restore();
});

const { GarminSection } = await import("./GarminSection");

describe("GarminSection", () => {
  it("shows the credential form when Garmin is not connected", () => {
    const html = renderToStaticMarkup(
      <GarminSection connected={false} onConnected={() => undefined} />,
    );

    expect(html).toContain("Connect Garmin");
    expect(html).toContain('data-testid="garmin-credentials-form"');
    expect(html).toContain("Save");
  });

  it("offers an update action when Garmin is already connected", () => {
    const html = renderToStaticMarkup(
      <GarminSection connected={true} onConnected={() => undefined} />,
    );

    expect(html).toContain("Garmin connected");
    expect(html).toContain("Update Garmin credentials");
    expect(html).toContain('data-testid="garmin-edit-credentials"');
    expect(html).not.toContain('data-testid="garmin-credentials-form"');
  });
});
