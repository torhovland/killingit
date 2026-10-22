import { describe, expect, it } from "bun:test";
import { resolveToday } from "./useToday";

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
