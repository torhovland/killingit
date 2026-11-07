import { describe, expect, it } from "bun:test";
import type { LlmCostBucket } from "@killingit/shared";
import {
  costBarIndex,
  costAxis,
  costSeries,
  dailyCostChart,
  formatCallCount,
  formatCostAxis,
  formatCostUsd,
  monthlyCostChart,
} from "./costChart";

const rows: LlmCostBucket[] = [
  {
    bucket: "2025-11",
    model: "openai/gpt",
    label: "GPT",
    kind: "season_plan",
    costUsd: 1,
    calls: 4,
  },
  {
    bucket: "2026-10",
    model: "openai/gpt",
    label: "GPT",
    kind: "season_plan",
    costUsd: 2,
    calls: 3,
  },
  {
    bucket: "2026-10",
    model: "anthropic/claude",
    label: "Claude",
    kind: "activity_analysis",
    costUsd: 0.5,
    calls: 1,
  },
  {
    bucket: "2026-11",
    model: "anthropic/claude",
    label: "Claude",
    kind: "activity_analysis",
    costUsd: 0.25,
    calls: 2,
  },
];

describe("costSeries", () => {
  it("orders models by all-time spend", () => {
    expect(costSeries(rows, "model")).toEqual([
      { series: "openai/gpt", label: "GPT", totalUsd: 3 },
      { series: "anthropic/claude", label: "Claude", totalUsd: 0.75 },
    ]);
  });

  it("orders prompt types by all-time spend", () => {
    expect(costSeries(rows, "kind")).toEqual([
      { series: "season_plan", label: "Season plan", totalUsd: 3 },
      {
        series: "activity_analysis",
        label: "Activity analysis",
        totalUsd: 0.75,
      },
    ]);
  });
});

describe("monthlyCostChart", () => {
  it("shows the last twelve months including empty months", () => {
    const chart = monthlyCostChart(rows, "12m", "2026-11-04", "model");

    expect(chart.buckets).toHaveLength(12);
    expect(chart.buckets[0]?.key).toBe("2025-12");
    expect(chart.buckets.at(-1)?.key).toBe("2026-11");
    expect(chart.buckets.find((bucket) => bucket.key === "2025-11")).toBe(
      undefined,
    );
    expect(chart.totalUsd).toBe(2.75);
    expect(chart.buckets.at(-1)?.parts).toEqual([
      { series: "anthropic/claude", costUsd: 0.25, calls: 2 },
    ]);
  });

  it("starts all time at the first recorded month", () => {
    const chart = monthlyCostChart(rows, "all", "2026-11-04", "model");

    expect(chart.buckets[0]?.key).toBe("2025-11");
    expect(chart.buckets.at(-1)?.key).toBe("2026-11");
    expect(chart.totalUsd).toBe(3.75);
    expect(chart.buckets[0]?.label).toBe("Nov 25");
  });

  it("stacks the same month by prompt type", () => {
    const chart = monthlyCostChart(rows, "all", "2026-11-04", "kind");

    expect(chart.totalUsd).toBe(3.75);
    expect(
      chart.buckets.find((bucket) => bucket.key === "2026-10")?.parts,
    ).toEqual([
      { series: "activity_analysis", costUsd: 0.5, calls: 1 },
      { series: "season_plan", costUsd: 2, calls: 3 },
    ]);
    expect(chart.series.map((series) => series.label)).toEqual([
      "Season plan",
      "Activity analysis",
    ]);
  });
});

describe("dailyCostChart", () => {
  const dailyRows: LlmCostBucket[] = [
    {
      bucket: "2026-10-01",
      model: "openai/gpt",
      label: "GPT",
      kind: "season_plan",
      costUsd: 0.1,
      calls: 1,
    },
    {
      bucket: "2026-11-04",
      model: "anthropic/claude",
      label: "Claude",
      kind: "activity_analysis",
      costUsd: 0.2,
      calls: 2,
    },
  ];

  it("keeps the chosen number of days including today", () => {
    expect(
      dailyCostChart(dailyRows, "7d", "2026-11-04", "model").buckets,
    ).toHaveLength(7);
    expect(
      dailyCostChart(dailyRows, "31d", "2026-11-04", "model").buckets,
    ).toHaveLength(31);
    expect(
      dailyCostChart(dailyRows, "365d", "2026-11-04", "model").buckets,
    ).toHaveLength(365);
    expect(
      dailyCostChart(dailyRows, "all", "2026-11-04", "model").buckets,
    ).toHaveLength(35);
  });

  it("only counts rows inside the daily window", () => {
    expect(
      dailyCostChart(dailyRows, "7d", "2026-11-04", "model").totalUsd,
    ).toBe(0.2);
    expect(
      dailyCostChart(dailyRows, "365d", "2026-11-04", "model").totalUsd,
    ).toBe(0.3);
    expect(
      dailyCostChart(dailyRows, "all", "2026-11-04", "model").totalUsd,
    ).toBe(0.3);
  });
});

describe("cost chart geometry", () => {
  it("maps a pointer fraction onto a bar and clamps the edges", () => {
    expect(costBarIndex(0, 10)).toBe(0);
    expect(costBarIndex(0.55, 10)).toBe(5);
    expect(costBarIndex(1, 10)).toBe(9);
    expect(costBarIndex(-1, 10)).toBe(0);
    expect(costBarIndex(0.5, 0)).toBe(-1);
  });

  it("builds round ticks from zero", () => {
    expect(costAxis(0.42)).toEqual({
      max: 0.6,
      ticks: [0, 0.2, 0.4, 0.6],
    });
  });

  it("formats small costs with more precision", () => {
    expect(formatCostUsd(0)).toBe("$0.00");
    expect(formatCostUsd(0.0012)).toBe("$0.0012");
    expect(formatCostUsd(1.2)).toBe("$1.20");
    expect(formatCostAxis(0)).toBe("$0");
    expect(formatCostAxis(0.2)).toBe("$0.20");
  });

  it("pluralizes a count of calls", () => {
    expect(formatCallCount(0)).toBe("0 calls");
    expect(formatCallCount(1)).toBe("1 call");
    expect(formatCallCount(4)).toBe("4 calls");
  });
});
