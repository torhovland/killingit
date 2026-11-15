import { describe, expect, it } from "bun:test";
import { seriesClass } from "./seriesClass";

describe("seriesClass", () => {
  it("returns the shared colours in order", () => {
    expect(seriesClass(0)).toEqual({
      stroke: "stroke-primary",
      background: "bg-primary",
    });
    expect(seriesClass(2)).toEqual({
      stroke: "stroke-form-fresh-line",
      background: "bg-form-fresh-line",
    });
  });

  it("wraps around to the first colour after the last", () => {
    expect(seriesClass(4)).toEqual(seriesClass(0));
    expect(seriesClass(6)).toEqual(seriesClass(2));
  });

  it("falls back to the first colour for an index past a custom palette", () => {
    const palette = [{ stroke: "stroke-a", background: "bg-a" }];

    expect(seriesClass(7, palette)).toEqual(palette[0]);
  });

  it("has no classes for an empty palette", () => {
    expect(seriesClass(0, [])).toBeUndefined();
  });
});
