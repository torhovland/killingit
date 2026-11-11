import { describe, expect, it } from "bun:test";
import { cn } from "./cn";

describe("cn", () => {
  it("joins its arguments and drops falsy values", () => {
    expect(cn("rounded", false, null, undefined, "border")).toBe(
      "rounded border",
    );
  });

  it("lets a later class override an earlier one", () => {
    expect(cn("px-3 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("rounded-lg", "rounded")).toBe("rounded");
  });
});
