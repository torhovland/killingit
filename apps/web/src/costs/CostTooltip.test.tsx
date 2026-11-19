import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CostTooltip } from "./CostTooltip";
import type { CostBucket, CostSeriesTotal } from "./costChart";

const bucket: CostBucket = {
  key: "2026-11",
  label: "Nov",
  title: "November 2026",
  totalUsd: 2.75,
  parts: [
    { series: "openai/gpt", costUsd: 2, calls: 3 },
    { series: "anthropic/claude", costUsd: 0.75, calls: 1 },
  ],
};

const series: CostSeriesTotal[] = [
  { series: "openai/gpt", label: "GPT", totalUsd: 2 },
  { series: "anthropic/claude", label: "Claude", totalUsd: 0.75 },
];

describe("CostTooltip", () => {
  it("shows the period total with its call count", () => {
    const html = renderToStaticMarkup(
      <CostTooltip bucket={bucket} series={series} left="50%" />,
    );

    expect(html).toContain("November 2026");
    expect(html).toContain("4 calls · $2.75");
  });

  it("shows each series' call count before its cost", () => {
    const html = renderToStaticMarkup(
      <CostTooltip bucket={bucket} series={series} left="50%" />,
    );

    expect(html.match(/data-testid="cost-tooltip-series"/g)).toHaveLength(2);
    // The larger series is listed first, each with its calls before its cost.
    const gptCalls = html.indexOf("3 calls");
    const gptCost = html.indexOf("$2.00");
    const claudeCalls = html.indexOf("1 call");
    const claudeCost = html.indexOf("$0.75");
    expect(gptCalls).toBeGreaterThan(-1);
    expect(gptCost).toBeGreaterThan(gptCalls);
    expect(claudeCalls).toBeGreaterThan(gptCost);
    expect(claudeCost).toBeGreaterThan(claudeCalls);
  });

  it("leaves out the call count when no calls were recorded", () => {
    const html = renderToStaticMarkup(
      <CostTooltip
        bucket={{ ...bucket, totalUsd: 0.5, parts: [] }}
        series={series}
        left="50%"
      />,
    );

    expect(html).toContain("$0.50");
    expect(html).not.toContain(" call");
  });
});
