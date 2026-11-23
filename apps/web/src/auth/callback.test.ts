import { describe, expect, it } from "bun:test";
import { hasAuthCallbackParams } from "./callback";

describe("hasAuthCallbackParams", () => {
  it("recognises a successful callback", () => {
    expect(hasAuthCallbackParams("?code=abc&state=xyz")).toBe(true);
  });

  it("recognises a callback that reported an error", () => {
    expect(hasAuthCallbackParams("?error=access_denied&state=xyz")).toBe(true);
  });

  it("does not treat an ordinary query as a callback", () => {
    expect(hasAuthCallbackParams("")).toBe(false);
    expect(hasAuthCallbackParams("?today=2026-11-23")).toBe(false);
    expect(hasAuthCallbackParams("?code=abc")).toBe(false);
    expect(hasAuthCallbackParams("?state=xyz")).toBe(false);
  });
});
