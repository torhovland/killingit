import { describe, expect, it } from "bun:test";
import { greetingSchema } from "@killingit/shared";

describe("greetingSchema", () => {
  it("parses a valid greeting", () => {
    expect(greetingSchema.parse({ message: "hi" }).message).toBe("hi");
  });
});
