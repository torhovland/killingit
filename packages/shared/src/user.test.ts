import { describe, expect, it } from "bun:test";
import {
  currentUserSchema,
  isValidTimeZone,
  timeZoneSchema,
  userRoleSchema,
  userSettingsUpdateSchema,
} from "./user.js";

describe("userRoleSchema", () => {
  it("accepts the two application roles", () => {
    expect(userRoleSchema.parse("admin")).toBe("admin");
    expect(userRoleSchema.parse("member")).toBe("member");
  });

  it("rejects unknown roles", () => {
    expect(() => userRoleSchema.parse("owner")).toThrow();
  });
});

describe("time zone schemas", () => {
  it("accepts IANA zones and rejects unknown ones", () => {
    expect(timeZoneSchema.parse("Europe/Oslo")).toBe("Europe/Oslo");
    expect(isValidTimeZone("Europe/Oslo")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(() => timeZoneSchema.parse("Mars/Olympus_Mons")).toThrow();
  });

  it("allows clearing the setting to use the device zone", () => {
    expect(userSettingsUpdateSchema.parse({ timezone: null })).toEqual({
      timezone: null,
    });
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
    expect(parsed.timezone).toBeNull();
  });

  it("keeps a configured time zone", () => {
    const parsed = currentUserSchema.parse({
      sub: "auth0|athlete-123",
      role: "member",
      timezone: "Europe/Oslo",
    });

    expect(parsed.timezone).toBe("Europe/Oslo");
  });

  it("rejects a payload without a role", () => {
    expect(() =>
      currentUserSchema.parse({ sub: "auth0|athlete-123" }),
    ).toThrow();
  });
});
