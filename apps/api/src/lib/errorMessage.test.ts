import { describe, expect, it } from "bun:test";
import { errorMessage } from "./errorMessage.js";

describe("errorMessage", () => {
  it("returns an error's message", () => {
    expect(errorMessage(new Error("the sidecar timed out"))).toBe(
      "the sidecar timed out",
    );
  });

  it("returns a subclass's message", () => {
    class SyncError extends Error {}

    expect(errorMessage(new SyncError("rate limited"))).toBe("rate limited");
  });

  it("stringifies a thrown value that is not an error", () => {
    expect(errorMessage("boom")).toBe("boom");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
