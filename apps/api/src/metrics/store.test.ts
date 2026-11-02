import { describe, expect, it } from "bun:test";
import { shouldRecordSource } from "./store.js";

describe("shouldRecordSource", () => {
  it("keeps an athlete-stated value when Garmin or the coach supplies one", () => {
    expect(shouldRecordSource("user", ["user"])).toBe(false);
  });

  it("lets Garmin replace a coach estimate", () => {
    expect(shouldRecordSource("coach", ["user"])).toBe(true);
  });

  it("lets an athlete-stated value replace Garmin", () => {
    expect(shouldRecordSource("garmin", [])).toBe(true);
  });

  it("stores a value when the day is empty", () => {
    expect(shouldRecordSource(undefined, ["user"])).toBe(true);
  });
});
