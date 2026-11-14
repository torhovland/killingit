import { describe, expect, it } from "bun:test";
import { formatDistanceKm } from "./formatDistance";

describe("formatDistanceKm", () => {
  it("keeps two decimals for a detail line", () => {
    expect(formatDistanceKm(25000)).toBe("25.00 km");
    expect(formatDistanceKm(25340)).toBe("25.34 km");
  });

  it("rounds to one decimal for the calendar's compact chip", () => {
    expect(formatDistanceKm(25340, 1)).toBe("25.3 km");
    expect(formatDistanceKm(0, 1)).toBe("0.0 km");
  });
});
