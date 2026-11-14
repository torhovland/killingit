import { describe, expect, it } from "bun:test";
import { idParamSchema } from "./index.js";

describe("idParamSchema", () => {
  it("parses a positive integer path id", () => {
    expect(idParamSchema.parse({ id: "12" })).toEqual({ id: 12 });
  });

  it("refuses an id that is not a whole positive number", () => {
    for (const id of ["0", "-1", "1.5", "abc", ""]) {
      expect(idParamSchema.safeParse({ id }).success).toBe(false);
    }
  });

  it("refuses an id past the PostgreSQL serial range", () => {
    expect(idParamSchema.safeParse({ id: "1e12" }).success).toBe(false);
    expect(idParamSchema.safeParse({ id: "2147483648" }).success).toBe(false);
    expect(idParamSchema.parse({ id: "2147483647" })).toEqual({
      id: 2_147_483_647,
    });
  });
});
