import { describe, expect, it } from "bun:test";
import { FORM_ZONES } from "@killingit/shared";
import {
  axisTicks,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  formatChartDate,
  formatZoneRange,
  indexAt,
  labelIndices,
  lastIndexOnOrBefore,
  linePath,
  niceDomain,
  tsbSegments,
  zoneBlocks,
} from "./chartGeometry";

describe("chartScale", () => {
  const scale = chartScale(5, { min: 0, max: 100 });

  it("spans the plot from the first day to the last", () => {
    expect(scale.plotWidth).toBe(
      CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right,
    );
    expect(scale.x(0)).toBe(0);
    expect(scale.x(4)).toBe(scale.plotWidth);
    expect(scale.x(2)).toBe(scale.plotWidth / 2);
  });

  it("puts the domain maximum at the top of the plot", () => {
    expect(scale.plotHeight).toBe(
      CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom,
    );
    expect(scale.y(100)).toBe(0);
    expect(scale.y(0)).toBe(scale.plotHeight);
    expect(scale.y(50)).toBe(scale.plotHeight / 2);
  });
});

describe("niceDomain", () => {
  it("pads the values and rounds to a tick boundary", () => {
    expect(niceDomain([12, 78])).toEqual({ min: 0, max: 100 });
  });

  it("gives flat data a readable span", () => {
    expect(niceDomain([250, 250])).toEqual({ min: 230, max: 270 });
  });

  it("falls back to a default span with no values", () => {
    expect(niceDomain([])).toEqual({ min: 0, max: 20 });
  });
});

describe("axisTicks", () => {
  it("lands on round numbers", () => {
    expect(axisTicks({ min: 0, max: 100 }, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(axisTicks({ min: -50, max: 100 }, 4)).toEqual([-50, 0, 50, 100]);
    expect(axisTicks({ min: 230, max: 270 }, 4)).toEqual([
      230, 240, 250, 260, 270,
    ]);
  });
});

describe("labelIndices", () => {
  it("spreads the labels over the points, keeping the edges", () => {
    expect(labelIndices(9)).toEqual([0, 3, 5, 8]);
    expect(labelIndices(3)).toEqual([0, 1, 2]);
    expect(labelIndices(1)).toEqual([0]);
    expect(labelIndices(0)).toEqual([]);
  });
});

describe("indexAt", () => {
  it("snaps a pointer position to the nearest day", () => {
    expect(indexAt(0, 5)).toBe(0);
    expect(indexAt(0.2, 5)).toBe(1);
    expect(indexAt(0.5, 5)).toBe(2);
    expect(indexAt(1, 5)).toBe(4);
    expect(indexAt(1.4, 5)).toBe(4);
    expect(indexAt(-0.3, 5)).toBe(0);
  });

  it("stays on the only day of a one-point chart", () => {
    expect(indexAt(0.7, 1)).toBe(0);
  });
});

describe("lastIndexOnOrBefore", () => {
  it("finds the last measured day", () => {
    const dates = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];

    expect(lastIndexOnOrBefore(dates, "2026-10-21")).toBe(1);
    expect(lastIndexOnOrBefore(dates, "2026-10-22")).toBe(2);
    expect(lastIndexOnOrBefore(dates, "2026-10-31")).toBe(3);
    expect(lastIndexOnOrBefore(dates, "2026-10-19")).toBe(-1);
    expect(lastIndexOnOrBefore([], "2026-10-19")).toBe(-1);
  });
});

describe("zoneBlocks", () => {
  it("clips the TSB zones to the visible domain", () => {
    const blocks = zoneBlocks({ min: -5, max: 40 });

    // Bands entirely outside the domain are dropped, the rest is trimmed.
    expect(blocks.map((block) => block.zone.interpretation)).toEqual([
      "maintaining",
      "fresh",
      "detraining",
    ]);
    expect(blocks[0]).toMatchObject({ from: -5, to: 5 });
    expect(blocks.at(-1)).toMatchObject({ from: 25, to: 40 });
  });

  it("keeps every zone when the whole scale is visible", () => {
    expect(zoneBlocks({ min: -50, max: 50 })).toHaveLength(FORM_ZONES.length);
  });
});

describe("paths", () => {
  const scale = chartScale(3, { min: 0, max: 10 });

  it("draws a polyline through the values", () => {
    expect(linePath([0, 5, 10], scale)).toBe(
      `M0 ${scale.plotHeight} L${scale.plotWidth / 2} ${scale.plotHeight / 2} L${scale.plotWidth} 0`,
    );
  });
});

describe("tsbSegments", () => {
  it("changes colour where the line crosses into the next zone", () => {
    const scale = chartScale(2, { min: -50, max: 50 });
    const segments = tsbSegments([20, 0], scale);

    expect(segments.map((segment) => segment.interpretation)).toEqual([
      "fresh",
      "maintaining",
    ]);
    // The step falls from +20 to 0, so it passes +5 three quarters of the way.
    expect(segments[0]?.from).toEqual({ x: 0, y: scale.y(20) });
    expect(segments[0]?.to).toEqual({
      x: 0.75 * scale.plotWidth,
      y: scale.y(5),
    });
    expect(segments[1]?.to).toEqual({ x: scale.plotWidth, y: scale.y(0) });
  });

  it("splits a step that crosses several zones", () => {
    const segments = tsbSegments(
      [10, -40],
      chartScale(2, { min: -50, max: 50 }),
    );

    expect(segments.map((segment) => segment.interpretation)).toEqual([
      "fresh",
      "maintaining",
      "productive",
      "risk",
    ]);
  });

  it("colours a flat step by its own zone", () => {
    const segments = tsbSegments([0, 0], chartScale(2, { min: -50, max: 50 }));

    expect(segments).toHaveLength(1);
    expect(segments[0]?.interpretation).toBe("maintaining");
  });
});

describe("formatZoneRange", () => {
  it("describes open-ended zones in words", () => {
    expect(
      formatZoneRange({ interpretation: "detraining", from: 25, to: Infinity }),
    ).toBe("above +25");
    expect(
      formatZoneRange({ interpretation: "risk", from: -Infinity, to: -30 }),
    ).toBe("below −30");
    expect(formatZoneRange({ interpretation: "fresh", from: 5, to: 25 })).toBe(
      "+5 to +25",
    );
  });
});

describe("formatChartDate", () => {
  it("writes a short day and month", () => {
    expect(formatChartDate("2026-10-22")).toBe("22 Oct");
  });

  it("passes through anything unexpected", () => {
    expect(formatChartDate("")).toBe("");
  });
});
