import { describe, expect, it } from "bun:test";
import { currentUserSchema, userRoleSchema } from "./user.js";

describe("userRoleSchema", () => {
  it("accepts the two application roles", () => {
    expect(userRoleSchema.parse("admin")).toBe("admin");
    expect(userRoleSchema.parse("member")).toBe("member");
  });

  it("rejects unknown roles", () => {
    expect(() => userRoleSchema.parse("owner")).toThrow();
  });
});

describe("currentUserSchema", () => {
  it("parses the signed-in user with their role", () => {
    const parsed = currentUserSchema.parse({
      sub: "auth0|athlete-123",
      role: "admin",
    });

    expect(parsed.sub).toBe("auth0|athlete-123");
    expect(parsed.role).toBe("admin");
  });

  it("rejects a payload without a role", () => {
    expect(() =>
      currentUserSchema.parse({ sub: "auth0|athlete-123" }),
    ).toThrow();
  });
});
