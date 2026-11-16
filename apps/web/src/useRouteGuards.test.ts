import { afterEach, describe, expect, it } from "bun:test";
import type { CurrentUser } from "@killingit/shared";
import { renderHook } from "@testing-library/react";
import { useRouteGuards, type RouteGuardOptions } from "./useRouteGuards";

const MEMBER: CurrentUser = {
  sub: "user-1",
  role: "member",
  timezone: null,
  location: null,
  dietAdvice: false,
};

const ADMIN: CurrentUser = { ...MEMBER, role: "admin" };

/**
 * Moves the test document to `path`. The suite starts on `about:blank`, whose
 * null origin refuses a relative history change, so the first hop names the
 * origin.
 */
function openPath(path: string): void {
  window.location.href = `http://localhost${path}`;
}

function renderGuards(options: RouteGuardOptions) {
  return renderHook((props: RouteGuardOptions) => useRouteGuards(props), {
    initialProps: options,
  });
}

afterEach(() => openPath("/coach"));

describe("useRouteGuards", () => {
  it("resolves a known path to its page and gate", () => {
    openPath("/calendar");

    const { result } = renderGuards({
      signedIn: true,
      loadingUser: false,
      user: MEMBER,
      isAdmin: false,
      surveyRequired: false,
    });

    expect(result.current.page).toBe("calendar");
    expect(result.current.gate).toBe("page");
    expect(window.location.pathname).toBe("/calendar");
  });

  it("replaces an unknown path with the coach page", () => {
    openPath("/no-such-page");

    const { result } = renderGuards({
      signedIn: true,
      loadingUser: false,
      user: MEMBER,
      isAdmin: false,
      surveyRequired: false,
    });

    expect(result.current.page).toBe("coach");
    expect(window.location.pathname).toBe("/coach");
  });

  it("sends an unanswered survey to the survey page", () => {
    openPath("/calendar");

    const { result } = renderGuards({
      signedIn: true,
      loadingUser: false,
      user: MEMBER,
      isAdmin: false,
      surveyRequired: true,
    });

    expect(result.current.gate).toBe("survey");
    expect(window.location.pathname).toBe("/survey");
  });

  it("waits on the admin page while the account's role loads", () => {
    openPath("/admin");

    const { result } = renderGuards({
      signedIn: true,
      loadingUser: true,
      user: null,
      isAdmin: false,
      surveyRequired: true,
    });

    expect(result.current.gate).toBe("wait");
    expect(window.location.pathname).toBe("/admin");
  });

  it("sends a member away from the admin page", () => {
    openPath("/admin");

    renderGuards({
      signedIn: true,
      loadingUser: false,
      user: MEMBER,
      isAdmin: false,
      surveyRequired: false,
    });

    expect(window.location.pathname).toBe("/coach");
  });

  it("keeps the admin on the admin page", () => {
    openPath("/admin");

    const { result } = renderGuards({
      signedIn: true,
      loadingUser: false,
      user: ADMIN,
      isAdmin: true,
      surveyRequired: true,
    });

    expect(result.current.gate).toBe("page");
    expect(window.location.pathname).toBe("/admin");
  });
});
