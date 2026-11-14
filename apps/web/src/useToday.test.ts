import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
} from "bun:test";
import { getToday, isDateOverrideAllowed, setTodayOverride } from "./useToday";

// Bun exposes Vite's `import.meta.env` as `process.env`, so these values reach
// `appEnvironment` when the module reads the deployment environment.
const originalAppEnv = process.env.VITE_APP_ENV;
const originalDev = process.env.DEV;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(() => {
  process.env.VITE_APP_ENV = "Test";
  delete process.env.DEV;
});

afterEach(() => {
  setSystemTime();
  localStorage.clear();
  restoreEnv("VITE_APP_ENV", originalAppEnv);
  restoreEnv("DEV", originalDev);
});

describe("getToday", () => {
  it("uses the real date when there is no override", () => {
    setSystemTime(new Date("2026-10-22T12:00:00Z"));

    expect(getToday("UTC")).toEqual({
      today: "2026-10-22",
      isAfter18: false,
      isOverridden: false,
    });
  });

  it("uses the override date when one is stored", () => {
    setSystemTime(new Date("2026-10-22T12:00:00Z"));
    setTodayOverride("2027-03-15");

    expect(getToday("UTC")).toEqual({
      today: "2027-03-15",
      isAfter18: false,
      isOverridden: true,
    });
  });

  it("ignores a stored value that is not a date", () => {
    setSystemTime(new Date("2026-10-22T12:00:00Z"));
    setTodayOverride("not-a-date");

    expect(getToday("UTC")).toEqual({
      today: "2026-10-22",
      isAfter18: false,
      isOverridden: false,
    });
  });

  it("uses the athlete's time zone for the date and evening cutoff", () => {
    setSystemTime(new Date(Date.UTC(2026, 9, 22, 23, 30, 0)));

    expect(getToday("Europe/Oslo")).toEqual({
      today: "2026-10-23",
      isAfter18: false,
      isOverridden: false,
    });
    expect(getToday("America/New_York")).toEqual({
      today: "2026-10-22",
      isAfter18: true,
      isOverridden: false,
    });
  });

  it("keeps the real time-of-day when the date is overridden", () => {
    setSystemTime(new Date("2026-10-22T19:00:00Z"));
    setTodayOverride("2027-03-15");

    expect(getToday("UTC")).toEqual({
      today: "2027-03-15",
      isAfter18: true,
      isOverridden: true,
    });
  });

  it("ignores the override outside development and test", () => {
    process.env.VITE_APP_ENV = "Production";
    setSystemTime(new Date("2026-10-22T12:00:00Z"));
    setTodayOverride("2027-03-15");

    expect(getToday("UTC")).toEqual({
      today: "2026-10-22",
      isAfter18: false,
      isOverridden: false,
    });
  });
});

describe("appEnvironment", () => {
  it("honours a valid configured environment", () => {
    process.env.VITE_APP_ENV = "Development";
    expect(isDateOverrideAllowed()).toBe(true);

    process.env.VITE_APP_ENV = "Test";
    expect(isDateOverrideAllowed()).toBe(true);

    process.env.VITE_APP_ENV = "Production";
    expect(isDateOverrideAllowed()).toBe(false);
  });

  it("falls back to Development when running the dev server", () => {
    process.env.VITE_APP_ENV = "not-a-real-env";
    process.env.DEV = "true";
    expect(isDateOverrideAllowed()).toBe(true);

    delete process.env.VITE_APP_ENV;
    expect(isDateOverrideAllowed()).toBe(true);
  });

  it("falls back to Production when not running the dev server", () => {
    delete process.env.VITE_APP_ENV;
    expect(isDateOverrideAllowed()).toBe(false);

    process.env.VITE_APP_ENV = "not-a-real-env";
    expect(isDateOverrideAllowed()).toBe(false);
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
