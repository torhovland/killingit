import { describe, expect, it } from "bun:test";
import {
  planChangeScopeIncludes,
  planChangeScopeSchema,
  widestPlanChangeScope,
} from "./planChangeScope.js";

describe("plan change scope", () => {
  it("parses only the five levels", () => {
    expect(planChangeScopeSchema.parse("season")).toBe("season");
    expect(planChangeScopeSchema.safeParse("month").success).toBe(false);
  });

  it("keeps the widest scope in a set", () => {
    expect(widestPlanChangeScope([])).toBe("none");
    expect(widestPlanChangeScope(["day", "week", "block"])).toBe("block");
    expect(widestPlanChangeScope(["season", "none"])).toBe("season");
    expect(widestPlanChangeScope(["day", "day"])).toBe("day");
  });

  it("compares scopes by the levels they include", () => {
    expect(planChangeScopeIncludes("season", "block")).toBe(true);
    expect(planChangeScopeIncludes("block", "block")).toBe(true);
    expect(planChangeScopeIncludes("block", "season")).toBe(false);
    expect(planChangeScopeIncludes("none", "day")).toBe(false);
  });
});
