import { describe, expect, it } from "bun:test";
import { API_BASE_URL, apiUrl } from "./apiUrl";

describe("apiUrl", () => {
  it("leaves a path unchanged for a same-origin build", () => {
    expect(apiUrl("/api/me", "")).toBe("/api/me");
  });

  it("prefixes a path with the configured origin", () => {
    expect(apiUrl("/api/me", "https://api.example.com")).toBe(
      "https://api.example.com/api/me",
    );
  });

  it("keeps a query string attached to the path", () => {
    expect(
      apiUrl("/api/calendar?month=2026-11", "https://api.example.com"),
    ).toBe("https://api.example.com/api/calendar?month=2026-11");
  });

  it("resolves against the build's origin by default", () => {
    expect(apiUrl("/api/me")).toBe(`${API_BASE_URL}/api/me`);
  });
});
