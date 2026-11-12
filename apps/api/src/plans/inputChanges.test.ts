import { describe, expect, it } from "bun:test";
import {
  summarizeCoachingInputChanges,
  summarizeReviewChanges,
} from "./inputChanges.js";

const at = (iso: string): Date => new Date(iso);

describe("summarizeCoachingInputChanges", () => {
  it("keeps the newest input and the newest that asks for a refresh", () => {
    const summary = summarizeCoachingInputChanges([
      { updatedAt: at("2026-10-20T08:00:00Z"), planChangeNeeded: true },
      { updatedAt: at("2026-10-21T08:00:00Z"), planChangeNeeded: false },
      { updatedAt: at("2026-10-19T08:00:00Z"), planChangeNeeded: true },
    ]);

    expect(summary.updatedAt).toEqual(at("2026-10-21T08:00:00Z"));
    expect(summary.refreshUpdatedAt).toEqual(at("2026-10-20T08:00:00Z"));
  });

  it("returns no refresh time when every input is context only", () => {
    const summary = summarizeCoachingInputChanges([
      { updatedAt: at("2026-10-21T08:00:00Z"), planChangeNeeded: false },
    ]);

    expect(summary.updatedAt).toEqual(at("2026-10-21T08:00:00Z"));
    expect(summary.refreshUpdatedAt).toBeNull();
  });

  it("returns nothing for no inputs", () => {
    expect(summarizeCoachingInputChanges([])).toEqual({
      updatedAt: null,
      refreshUpdatedAt: null,
    });
  });
});

describe("summarizeReviewChanges", () => {
  it("uses only the newest event of each kind", () => {
    const summary = summarizeReviewChanges([
      {
        kind: "week",
        updatedAt: at("2026-10-20T08:00:00Z"),
        planChangeNeeded: true,
      },
      {
        kind: "week",
        updatedAt: at("2026-10-21T08:00:00Z"),
        planChangeNeeded: false,
      },
      {
        kind: "block",
        updatedAt: at("2026-10-22T08:00:00Z"),
        planChangeNeeded: true,
      },
    ]);

    expect(summary.weekUpdatedAt).toEqual(at("2026-10-21T08:00:00Z"));
    expect(summary.weekNeedsRefresh).toBe(false);
    expect(summary.blockUpdatedAt).toEqual(at("2026-10-22T08:00:00Z"));
    expect(summary.blockNeedsRefresh).toBe(true);
  });

  it("reports no review of a kind as not pending", () => {
    const summary = summarizeReviewChanges([]);

    expect(summary.weekUpdatedAt).toBeNull();
    expect(summary.weekNeedsRefresh).toBe(false);
    expect(summary.blockUpdatedAt).toBeNull();
    expect(summary.blockNeedsRefresh).toBe(false);
  });
});
