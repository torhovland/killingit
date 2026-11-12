import { describe, expect, it } from "bun:test";
import { trappedFocusIndex } from "./modalFocus";

describe("trappedFocusIndex", () => {
  it("lets the browser move focus when the press stays inside", () => {
    expect(trappedFocusIndex(3, 1, false)).toBeNull();
    expect(trappedFocusIndex(3, 1, true)).toBeNull();
  });

  it("wraps Tab past the last element back to the first", () => {
    expect(trappedFocusIndex(3, 2, false)).toBe(0);
  });

  it("wraps Shift+Tab before the first element to the last", () => {
    expect(trappedFocusIndex(3, 0, true)).toBe(2);
  });

  it("moves into the dialog when focus is on the panel or outside it", () => {
    expect(trappedFocusIndex(3, -1, false)).toBe(0);
    expect(trappedFocusIndex(3, -1, true)).toBe(2);
  });

  it("keeps focus on the panel when it has no focusable children", () => {
    expect(trappedFocusIndex(0, -1, false)).toBeNull();
    expect(trappedFocusIndex(0, 0, false)).toBe(-1);
  });

  it("wraps a single focusable element back to itself", () => {
    expect(trappedFocusIndex(1, 0, false)).toBe(0);
    expect(trappedFocusIndex(1, 0, true)).toBe(0);
  });
});
