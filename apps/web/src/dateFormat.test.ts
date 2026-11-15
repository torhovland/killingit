import { describe, expect, it } from "bun:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  formatDayMonth,
  formatDayMonthYear,
  formatLongMonthYear,
  formatShortMonth,
  formatShortMonthYear,
  formatWeekdayDayMonth,
  formatWeekdayDayMonthYear,
} from "./dateFormat";

describe("month labels", () => {
  it("names January in short and long form", () => {
    expect(formatShortMonth("2026-01")).toBe("Jan");
    expect(formatShortMonthYear("2026-01")).toBe("Jan 26");
    expect(formatLongMonthYear("2026-01")).toBe("January 2026");
  });

  it("names December in short and long form", () => {
    expect(formatShortMonth("2026-12")).toBe("Dec");
    expect(formatShortMonthYear("2026-12")).toBe("Dec 26");
    expect(formatLongMonthYear("2026-12")).toBe("December 2026");
  });

  it("passes through a month key it cannot parse", () => {
    expect(formatShortMonth("2026-13")).toBe("2026-13");
    expect(formatLongMonthYear("not-a-month")).toBe("not-a-month");
  });
});

describe("day labels", () => {
  it("writes the day before the short month, as the charts do", () => {
    expect(formatDayMonth("2026-01-01")).toBe("1 Jan");
    expect(formatDayMonth("2026-12-31")).toBe("31 Dec");
    expect(formatDayMonthYear("2026-01-01")).toBe("1 Jan 2026");
  });

  it("passes through a date it cannot parse", () => {
    expect(formatDayMonth("")).toBe("");
    expect(formatDayMonth("2026-13-01")).toBe("2026-13-01");
  });
});

describe("calendar, plan and diet labels", () => {
  it("keeps the weekday-first formats those pages already render", () => {
    expect(formatWeekdayDayMonth("2026-01-01")).toBe("Thu, Jan 1");
    expect(formatWeekdayDayMonth("2026-12-31")).toBe("Thu, Dec 31");
    expect(formatWeekdayDayMonthYear("2026-01-01")).toBe("Thu, Jan 1, 2026");
  });

  it("passes through a date it cannot parse", () => {
    expect(formatWeekdayDayMonth("nonsense")).toBe("nonsense");
    expect(formatWeekdayDayMonthYear("")).toBe("");
  });
});

describe("device time zone", () => {
  it("keeps a January key on New Year's Day west of Greenwich", () => {
    const moduleUrl = pathToFileURL(
      path.resolve(import.meta.dir, "dateFormat.ts"),
    );
    const script = `
      import {
        formatDayMonth,
        formatDayMonthYear,
        formatLongMonthYear,
      } from ${JSON.stringify(moduleUrl.href)};
      process.stdout.write(
        JSON.stringify([
          formatDayMonth("2026-01-01"),
          formatDayMonthYear("2026-01-01"),
          formatLongMonthYear("2026-01"),
        ]),
      );
    `;
    const child = Bun.spawnSync(["bun", "-e", script], {
      env: { ...process.env, TZ: "America/Los_Angeles" },
    });

    expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout.toString())).toEqual([
      "1 Jan",
      "1 Jan 2026",
      "January 2026",
    ]);
  });
});
