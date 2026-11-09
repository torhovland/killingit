import { describe, expect, it } from "bun:test";
import { addDays, startOfWeek, weekDates } from "./date.js";

describe("addDays", () => {
  it("moves across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-10-21", 7)).toBe("2026-10-28");
  });

  it("moves across a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
});

describe("startOfWeek", () => {
  it("returns the Monday of the week containing the date", () => {
    expect(startOfWeek("2026-10-21")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
  });

  it("handles a week that crosses a month boundary", () => {
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
  });
});

describe("weekDates", () => {
  it("lists the seven dates starting on the given Monday", () => {
    expect(weekDates("2026-10-26")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });
});
