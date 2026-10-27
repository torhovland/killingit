import { describe, expect, it } from "bun:test";
import {
  buildMonthGrid,
  clampMonth,
  dayNumber,
  formatMonth,
  monthOf,
  shiftMonth,
} from "./calendarDates";

describe("calendarDates", () => {
  it("reads and shifts months across year boundaries", () => {
    expect(monthOf("2026-10-27")).toBe("2026-10");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("clamps a month to the available range", () => {
    expect(clampMonth("2026-09", "2026-10", "2026-12")).toBe("2026-10");
    expect(clampMonth("2027-01", "2026-10", "2026-12")).toBe("2026-12");
    expect(clampMonth("2026-11", "2026-10", "2026-12")).toBe("2026-11");
  });

  it("builds six Monday-start weeks", () => {
    const grid = buildMonthGrid("2026-10");
    expect(grid).toHaveLength(42);
    expect(grid[0]?.date).toBe("2026-09-28");
    expect(grid[0]?.inMonth).toBe(false);
    expect(grid[3]?.date).toBe("2026-10-01");
    expect(grid[3]?.inMonth).toBe(true);
    expect(grid.at(-1)?.date).toBe("2026-11-08");
  });

  it("formats the month heading and day number", () => {
    expect(formatMonth("2026-10")).toContain("2026");
    expect(formatMonth("2026-10")).toContain("October");
    expect(dayNumber("2026-10-07")).toBe(7);
  });
});
