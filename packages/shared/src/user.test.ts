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

describe("location settings", () => {
  it("accepts a location and clears it with null", () => {
    expect(
      userSettingsUpdateSchema.parse({
        location: {
          latitude: 59.91,
          longitude: 10.75,
          name: "Oslo, Norway",
        },
      }),
    ).toEqual({
      location: { latitude: 59.91, longitude: 10.75, name: "Oslo, Norway" },
    });
    expect(userSettingsUpdateSchema.parse({ location: null })).toEqual({
      location: null,
    });
  });

  it("defaults a missing name and rejects out-of-range coordinates", () => {
    expect(
      userSettingsUpdateSchema.parse({
        location: { latitude: 59.91, longitude: 10.75 },
      }).location,
    ).toEqual({ latitude: 59.91, longitude: 10.75, name: null });
    expect(() =>
      userSettingsUpdateSchema.parse({
        location: { latitude: 91, longitude: 10 },
      }),
    ).toThrow();
  });

  it("rejects an empty settings patch", () => {
    expect(() => userSettingsUpdateSchema.parse({})).toThrow();
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
    expect(parsed.location).toBeNull();
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
