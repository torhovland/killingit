import { describe, expect, it } from "bun:test";
import { addDays, startOfWeek } from "./dates.js";

describe("startOfWeek", () => {
  it("returns the Monday of the week containing the date", () => {
    expect(startOfWeek("2026-10-21")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
  });
});

describe("addDays", () => {
  it("moves across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-10-21", 7)).toBe("2026-10-28");
  });
});
