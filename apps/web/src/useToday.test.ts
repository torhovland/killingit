import { describe, expect, it } from "bun:test";
import {
  isDateOverrideAllowed,
  resolveAppEnvironment,
  resolveToday,
} from "./useToday";

describe("resolveToday", () => {
  it("uses the real date when there is no override", () => {
    const now = new Date(2026, 9, 22, 12, 0, 0);
    expect(resolveToday(now, null)).toEqual({
      today: "2026-10-22",
      isAfter18: false,
      isOverridden: false,
    });
  });

  it("uses the override date when one is provided", () => {
    const now = new Date(2026, 9, 22, 12, 0, 0);
    expect(resolveToday(now, "2027-03-15")).toEqual({
      today: "2027-03-15",
      isAfter18: false,
      isOverridden: true,
    });
  });

  it("keeps the real time-of-day when the date is overridden", () => {
    const now = new Date(2026, 9, 22, 19, 0, 0);
    expect(resolveToday(now, "2027-03-15")).toEqual({
      today: "2027-03-15",
      isAfter18: true,
      isOverridden: true,
    });
  });
});

describe("resolveAppEnvironment", () => {
  it("honours a valid configured environment", () => {
    expect(resolveAppEnvironment("Development", false)).toBe("Development");
    expect(resolveAppEnvironment("Test", false)).toBe("Test");
    expect(resolveAppEnvironment("Production", true)).toBe("Production");
  });

  it("falls back to Development when running the dev server", () => {
    expect(resolveAppEnvironment(undefined, true)).toBe("Development");
    expect(resolveAppEnvironment("not-a-real-env", true)).toBe("Development");
  });

  it("falls back to Production when not running the dev server", () => {
    expect(resolveAppEnvironment(undefined, false)).toBe("Production");
  });
});

describe("isDateOverrideAllowed", () => {
  it("allows the override in Development and Test", () => {
    expect(isDateOverrideAllowed("Development")).toBe(true);
    expect(isDateOverrideAllowed("Test")).toBe(true);
  });

  it("hides the override in Production", () => {
    expect(isDateOverrideAllowed("Production")).toBe(false);
  });
});
