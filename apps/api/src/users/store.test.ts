import { describe, expect, it } from "bun:test";
import { planUserProvisioning } from "./store.js";

describe("planUserProvisioning", () => {
  it("makes every account a member when no administrator is configured", () => {
    expect(planUserProvisioning("auth0|first-athlete", null)).toEqual({
      role: "member",
    });
  });

  it("grants the admin role to the configured auth subject", () => {
    expect(planUserProvisioning("auth0|owner", "auth0|owner")).toEqual({
      role: "admin",
    });
  });

  it("makes every other account a member", () => {
    expect(planUserProvisioning("auth0|athlete", "auth0|owner")).toEqual({
      role: "member",
    });
  });
});
