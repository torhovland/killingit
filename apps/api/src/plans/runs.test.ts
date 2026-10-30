import { describe, expect, it } from "bun:test";
import { claimRun, releaseRun } from "./runs.js";

describe("coach runs", () => {
  it("aborts the previous run when a newer one is claimed", () => {
    const first = claimRun(1);
    const second = claimRun(1);

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(first.runId).not.toBe(second.runId);
    releaseRun(1, second.runId);
  });

  it("does not release a controller owned by a newer run", () => {
    const first = claimRun(2);
    const second = claimRun(2);

    releaseRun(2, first.runId);

    expect(second.signal.aborted).toBe(false);
    releaseRun(2, second.runId);
  });
});
