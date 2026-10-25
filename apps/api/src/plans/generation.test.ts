import { describe, expect, it } from "bun:test";
import type { PlanGenerationStatus } from "@killingit/shared";
import { isStaleRunning, STALE_GENERATION_MS } from "./generation.js";

const NOW = Date.parse("2026-10-25T12:00:00Z");

function status(
  state: PlanGenerationStatus["status"],
  updatedAt: string,
): PlanGenerationStatus {
  return { status: state, step: null, progress: 0, error: null, updatedAt };
}

describe("isStaleRunning", () => {
  it("keeps a freshly updated run live", () => {
    expect(
      isStaleRunning(
        status(
          "running",
          new Date(NOW - STALE_GENERATION_MS + 1000).toISOString(),
        ),
        NOW,
      ),
    ).toBe(false);
  });

  it("marks a run stale once its lease has expired", () => {
    expect(
      isStaleRunning(
        status(
          "running",
          new Date(NOW - STALE_GENERATION_MS - 1000).toISOString(),
        ),
        NOW,
      ),
    ).toBe(true);
  });

  it("only considers running runs", () => {
    const old = new Date(NOW - STALE_GENERATION_MS * 2).toISOString();
    expect(isStaleRunning(status("done", old), NOW)).toBe(false);
    expect(isStaleRunning(status("error", old), NOW)).toBe(false);
    expect(isStaleRunning(status("idle", old), NOW)).toBe(false);
  });
});
