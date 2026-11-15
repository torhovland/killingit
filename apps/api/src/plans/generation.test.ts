import { describe, expect, it } from "bun:test";
import type { PlanGenerationStatus } from "@killingit/shared";
import { isStaleRunning } from "./generation.js";

const NOW = Date.parse("2026-10-25T12:00:00Z");
/** A running row is stale once its five-minute lease has expired. */
const LEASE_MS = 5 * 60 * 1000;

function status(
  state: PlanGenerationStatus["status"],
  updatedAt: string,
): PlanGenerationStatus {
  return {
    status: state,
    step: null,
    progress: 0,
    error: null,
    runId: null,
    updatedAt,
  };
}

describe("isStaleRunning", () => {
  it("keeps a freshly updated run live", () => {
    expect(
      isStaleRunning(
        status("running", new Date(NOW - LEASE_MS + 1000).toISOString()),
        NOW,
      ),
    ).toBe(false);
  });

  it("marks a run stale once its lease has expired", () => {
    expect(
      isStaleRunning(
        status("running", new Date(NOW - LEASE_MS - 1000).toISOString()),
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps a run alive through a slow provider call", () => {
    expect(
      isStaleRunning(
        status("running", new Date(NOW - 3 * 60 * 1000).toISOString()),
        NOW,
      ),
    ).toBe(false);
  });

  it("only considers running runs", () => {
    const old = new Date(NOW - LEASE_MS * 2).toISOString();
    expect(isStaleRunning(status("done", old), NOW)).toBe(false);
    expect(isStaleRunning(status("error", old), NOW)).toBe(false);
    expect(isStaleRunning(status("idle", old), NOW)).toBe(false);
  });
});
