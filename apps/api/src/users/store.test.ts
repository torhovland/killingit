import { describe, expect, it } from "bun:test";
import { planUserProvisioning } from "./store.js";

describe("planUserProvisioning", () => {
  it("makes the first account in an empty environment an admin", () => {
    expect(planUserProvisioning(0, false)).toEqual({
      promoteEarliest: false,
      role: "admin",
    });
  });

  it("adds later accounts as members when an admin exists", () => {
    expect(planUserProvisioning(3, true)).toEqual({
      promoteEarliest: false,
      role: "member",
    });
  });

  it("promotes the earliest account when the database has users but no admin", () => {
    expect(planUserProvisioning(2, false)).toEqual({
      promoteEarliest: true,
      role: "member",
    });
  });
});
