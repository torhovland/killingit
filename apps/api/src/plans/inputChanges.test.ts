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
      refreshChanges: [],
    });
  });

  it("keeps the scope of every refresh-worthy input", () => {
    const summary = summarizeCoachingInputChanges([
      {
        updatedAt: at("2026-10-20T08:00:00Z"),
        planChangeNeeded: true,
        planChangeScope: "day",
      },
      {
        updatedAt: at("2026-10-21T08:00:00Z"),
        planChangeNeeded: true,
        planChangeScope: "season",
      },
      {
        updatedAt: at("2026-10-22T08:00:00Z"),
        planChangeNeeded: false,
        planChangeScope: "none",
      },
    ]);

    // The context-only input is not a refresh, so it cannot hide or widen the
    // scopes of the two inputs that do ask for one.
    expect(summary.refreshChanges).toEqual([
      {
        updatedAt: at("2026-10-20T08:00:00Z"),
        planChangeScope: "day",
      },
      {
        updatedAt: at("2026-10-21T08:00:00Z"),
        planChangeScope: "season",
      },
    ]);
  });

  it("fails a refresh-worthy input without a scope open to the season", () => {
    const summary = summarizeCoachingInputChanges([
      { updatedAt: at("2026-10-20T08:00:00Z"), planChangeNeeded: true },
    ]);

    expect(summary.refreshChanges).toEqual([
      {
        updatedAt: at("2026-10-20T08:00:00Z"),
        planChangeScope: "season",
      },
    ]);
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

  it("keeps the scope of the newest review event per kind", () => {
    const summary = summarizeReviewChanges([
      {
        kind: "week",
        updatedAt: at("2026-10-20T08:00:00Z"),
        planChangeNeeded: true,
        planChangeScope: "season",
      },
      {
        kind: "week",
        updatedAt: at("2026-10-21T08:00:00Z"),
        planChangeNeeded: true,
        planChangeScope: "block",
      },
      {
        kind: "block",
        updatedAt: at("2026-10-22T08:00:00Z"),
        planChangeNeeded: true,
        planChangeScope: "season",
      },
    ]);

    // Only the newest event of a kind matters: an older season-scoped week
    // review must not keep widening the block after the plan has seen it.
    expect(summary.weekScope).toBe("block");
    expect(summary.blockScope).toBe("season");
  });
});
