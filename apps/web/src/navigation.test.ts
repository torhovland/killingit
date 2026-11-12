import { describe, expect, it } from "bun:test";
import {
  PAGES,
  pageForPath,
  pageLabel,
  pagePath,
  pageWidthClass,
} from "./navigation";

describe("page routes", () => {
  it("gives every page a distinct, canonical path", () => {
    const paths = PAGES.map(pagePath);

    expect(paths).toEqual([
      "/coach",
      "/diet",
      "/fitness",
      "/calendar",
      "/activities",
      "/season-review",
      "/survey",
      "/costs",
      "/settings",
      "/admin",
    ]);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.endsWith("/")).toBe(false);
    }
  });

  it("finds the page for each canonical path", () => {
    for (const page of PAGES) {
      expect(pageForPath(pagePath(page))).toBe(page);
    }
  });

  it("tolerates a trailing slash but not an unknown path", () => {
    expect(pageForPath("/season-review/")).toBe("seasonReview");
    expect(pageForPath("/settings/")).toBe("settings");
    expect(pageForPath("/")).toBeNull();
    expect(pageForPath("/season_review")).toBeNull();
    expect(pageForPath("/nope")).toBeNull();
  });

  it("labels the pages for the account menu", () => {
    expect(pageLabel("coach")).toBe("Coach");
    expect(pageLabel("seasonReview")).toBe("Season review");
    expect(pageLabel("survey")).toBe("Coaching survey");
    expect(pageLabel("costs")).toBe("AI costs");
    expect(pageLabel("admin")).toBe("Admin settings");
  });

  it("gives only the calendar the wide content panel", () => {
    expect(pageWidthClass("calendar")).toBe("max-w-7xl");
    for (const page of PAGES.filter((entry) => entry !== "calendar")) {
      expect(pageWidthClass(page)).toBe("max-w-5xl");
    }
  });
});
